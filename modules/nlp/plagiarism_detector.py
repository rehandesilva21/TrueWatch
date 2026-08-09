import os
import json
import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity
from modules.nlp.document_parser import (
    read_document, clean_text, split_into_sentences,
    split_into_chunks, remove_stopwords
)

try:
    from modules.nlp.plagiarism_classifier import load_classifier, predict_best_match
    _CLASSIFIER_IMPORTED = True
except Exception as e:
    print(f"Plagiarism classifier unavailable ({e}) — falling back to TF-IDF + semantic only.")
    _CLASSIFIER_IMPORTED = False

# ─── Corpus manager ────────────────────────────────────────────
CORPUS_PATH = "data/corpus"

def load_corpus():
    """
    Load all reference documents from the corpus folder.
    Returns list of (filename, cleaned_text) tuples.
    """
    os.makedirs(CORPUS_PATH, exist_ok=True)
    documents = []
    for fname in os.listdir(CORPUS_PATH):
        fpath = os.path.join(CORPUS_PATH, fname)
        if os.path.isfile(fpath):
            text = read_document(fpath)
            if text:
                documents.append((fname, clean_text(text)))
    return documents

def save_to_corpus(file_path):
    """Add a document to the reference corpus."""
    os.makedirs(CORPUS_PATH, exist_ok=True)
    fname = os.path.basename(file_path)
    text  = read_document(file_path)
    if text:
        dest = os.path.join(CORPUS_PATH, fname)
        with open(dest, 'w', encoding='utf-8') as f:
            f.write(text)
        print(f"Added to corpus: {fname}")
        return True
    return False


# ─── TF-IDF similarity ─────────────────────────────────────────
class TFIDFChecker:
    def __init__(self):
        self.vectorizer = TfidfVectorizer(
            ngram_range=(1, 2),   # unigrams and bigrams only
            min_df=1,
            max_df=1.0,           # don't filter any terms
            sublinear_tf=True,
            analyzer='word',
        )

    def check(self, query_text, corpus_docs):
        if not corpus_docs:
            return []

        query_clean  = clean_text(query_text)
        corpus_texts = [clean_text(text) for _, text in corpus_docs]
        corpus_names = [name for name, _ in corpus_docs]

        all_texts = [query_clean] + corpus_texts

        try:
            tfidf_matrix = self.vectorizer.fit_transform(all_texts)
            query_vec    = tfidf_matrix[0]
            corpus_vecs  = tfidf_matrix[1:]
            similarities = cosine_similarity(query_vec, corpus_vecs)[0]

            results = list(zip(corpus_names, similarities.tolist()))
            results.sort(key=lambda x: x[1], reverse=True)
            return results
        except Exception as e:
            print(f"TF-IDF error: {e}")
            return []


# ─── Semantic similarity ───────────────────────────────────────
class SemanticChecker:
    def __init__(self):
        self.model  = None
        self.loaded = False

    def load(self):
        """Lazy load — only load when needed (large model)."""
        if not self.loaded:
            print("Loading semantic similarity model...")
            from sentence_transformers import SentenceTransformer
            self.model  = SentenceTransformer('paraphrase-MiniLM-L6-v2')
            self.loaded = True
            print("Semantic model loaded.")

    def check_chunks(self, query_text, corpus_docs, threshold=0.75):
        """
        Compare query chunks against corpus chunks semantically.
        Catches paraphrased plagiarism that TF-IDF misses.
        Returns list of suspicious matches.
        """
        self.load()
        query_chunks  = split_into_chunks(query_text, chunk_size=100)

        if not query_chunks or not corpus_docs:
            return []

        suspicious = []

        for corpus_name, corpus_text in corpus_docs:
            corpus_chunks = split_into_chunks(corpus_text, chunk_size=100)
            if not corpus_chunks:
                continue

            # Encode all chunks
            try:
                q_embeddings = self.model.encode(
                    query_chunks, batch_size=16, show_progress_bar=False
                )
                c_embeddings = self.model.encode(
                    corpus_chunks, batch_size=16, show_progress_bar=False
                )

                # Pairwise similarity
                sim_matrix = cosine_similarity(q_embeddings, c_embeddings)

                # Find suspicious pairs
                for qi, q_chunk in enumerate(query_chunks):
                    max_sim_idx = np.argmax(sim_matrix[qi])
                    max_sim     = float(sim_matrix[qi][max_sim_idx])

                    if max_sim >= threshold:
                        suspicious.append({
                            "query_chunk":  q_chunk[:200],
                            "matched_chunk": corpus_chunks[max_sim_idx][:200],
                            "source":       corpus_name,
                            "similarity":   round(max_sim, 3),
                        })
            except Exception as e:
                print(f"Semantic check error: {e}")
                continue

        # Sort by similarity
        suspicious.sort(key=lambda x: x["similarity"], reverse=True)
        return suspicious


# ─── Main plagiarism detector ──────────────────────────────────
class PlagiarismDetector:
    def __init__(self):
        self.tfidf_checker    = TFIDFChecker()
        self.semantic_checker = SemanticChecker()

        # Trained binary classifier (Clough & Stevenson corpus, 96.8%
        # leave-one-task-out accuracy) — loading the pickled model itself is
        # cheap; the heavy sentence-transformer it needs for one of its
        # features is lazy-loaded separately inside plagiarism_classifier.py.
        self.classifier_available = False
        if _CLASSIFIER_IMPORTED:
            try:
                load_classifier()
                self.classifier_available = True
            except Exception as e:
                print(f"Could not load plagiarism classifier ({e}) — "
                      f"continuing with TF-IDF + semantic only.")

    def analyze(self, file_path, use_semantic=True):
        """
        Full plagiarism analysis pipeline.
        Returns a detailed report dict.
        """
        print(f"\nAnalyzing: {os.path.basename(file_path)}")
        print("─" * 50)

        # ── Read document ──────────────────────────────────
        raw_text = read_document(file_path)
        if not raw_text:
            return {"error": "Could not read document", "file": file_path}

        clean    = clean_text(raw_text)
        sentences = split_into_sentences(raw_text)
        word_count = len(raw_text.split())
        print(f"Document: {word_count} words, {len(sentences)} sentences")

        # ── Load corpus ────────────────────────────────────
        corpus = load_corpus()
        print(f"Corpus: {len(corpus)} reference documents")

        if not corpus:
            return {
                "file":           os.path.basename(file_path),
                "word_count":     word_count,
                "sentence_count": len(sentences),
                "originality":    100.0,
                # Must be a real RiskLevel value ("LOW"/"MEDIUM"/"HIGH"/
                # "CRITICAL") — check_plagiarism() in api.py constructs
                # RiskLevel(report["risk_level"]) for the DB row, and a
                # non-member string here throws a 500 at save time. Nothing
                # empty-corpus-specific is at risk of being lost since the
                # summary text below already explains why originality is
                # 100% — there's simply nothing to compare against yet.
                "risk_level":     "LOW",
                "tfidf_matches":  [],
                "semantic_matches": [],
                "summary":        "No reference documents in corpus to compare against.",
            }

        # ── TF-IDF check ───────────────────────────────────
        print("Running TF-IDF similarity check...")
        tfidf_results = self.tfidf_checker.check(clean, corpus)
        top_tfidf     = tfidf_results[:3] if tfidf_results else []
        max_tfidf     = tfidf_results[0][1] if tfidf_results else 0.0

        # ── Semantic check ─────────────────────────────────
        semantic_matches = []
        if use_semantic and corpus:
            print("Running semantic similarity check...")
            semantic_matches = self.semantic_checker.check_chunks(
                clean, corpus, threshold=0.75
            )
            print(f"Found {len(semantic_matches)} suspicious passages")

        # ── Trained classifier check ────────────────────────
        classifier_source, classifier_prob = None, 0.0
        if self.classifier_available:
            print("Running trained classifier check...")
            try:
                classifier_source, classifier_prob = predict_best_match(clean, corpus)
                print(f"Classifier: {classifier_prob:.1%} plagiarized "
                      f"(best match: {classifier_source})")
            except Exception as e:
                print(f"Classifier check error: {e}")

        # ── Calculate originality score ────────────────────
        # TF-IDF direct score
        tfidf_penalty = max_tfidf * 100

        # Semantic: weight by both count AND highest similarity score
        top_sem_score    = semantic_matches[0]["similarity"] if semantic_matches else 0.0
        semantic_penalty = min(
            (len(semantic_matches) * 6) + (top_sem_score * 40), 80
        )

        if self.classifier_available:
            # Trained model gets the largest weight — it's the only signal
            # here that's been cross-validated against ground truth (96.8%
            # leave-one-task-out accuracy) rather than hand-tuned.
            classifier_penalty = classifier_prob * 100
            plagiarism_score = min(
                (tfidf_penalty * 0.3) + (semantic_penalty * 0.3) + (classifier_penalty * 0.4),
                100
            )
        else:
            plagiarism_score = min(
                (tfidf_penalty * 0.5) + (semantic_penalty * 0.5), 100
            )
        originality = round(100 - plagiarism_score, 1)

        # ── Risk level ─────────────────────────────────────
        if originality >= 85:
            risk = "LOW"
        elif originality >= 60:
            risk = "MEDIUM"
        elif originality >= 40:
            risk = "HIGH"
        else:
            risk = "CRITICAL"

        # ── Build report ───────────────────────────────────
        report = {
            "file":             os.path.basename(file_path),
            "word_count":       word_count,
            "sentence_count":   len(sentences),
            "originality":      originality,
            "risk_level":       risk,
            "tfidf_matches":    [
                {"source": name, "similarity": round(score * 100, 1)}
                for name, score in top_tfidf
            ],
            "semantic_matches": semantic_matches[:10],  # top 10
            "classifier_match": (
                {"source": classifier_source, "probability": round(classifier_prob * 100, 1)}
                if classifier_source else None
            ),
            "summary": (
                f"Document is {originality}% original. "
                f"Risk level: {risk}. "
                f"Top TF-IDF match: {round(max_tfidf * 100, 1)}%. "
                f"Suspicious passages found: {len(semantic_matches)}."
                + (f" Trained classifier: {round(classifier_prob * 100, 1)}% plagiarized."
                   if self.classifier_available else "")
            )
        }

        # ── Print summary ──────────────────────────────────
        print(f"\nResults:")
        print(f"  Originality  : {originality}%")
        print(f"  Risk level   : {risk}")
        print(f"  TF-IDF match : {round(max_tfidf * 100, 1)}%")
        print(f"  Suspicious   : {len(semantic_matches)} passages")
        if self.classifier_available:
            print(f"  Classifier   : {round(classifier_prob * 100, 1)}% plagiarized")

        if semantic_matches:
            print(f"\nTop suspicious passage:")
            print(f"  Query  : {semantic_matches[0]['query_chunk'][:100]}...")
            print(f"  Source : {semantic_matches[0]['matched_chunk'][:100]}...")
            print(f"  Score  : {semantic_matches[0]['similarity']}")

        return report

    def save_report(self, report, output_path="data/processed"):
        """Save report as JSON."""
        os.makedirs(output_path, exist_ok=True)
        fname    = report.get("file", "report").replace(".", "_") + "_plagiarism.json"
        fpath    = os.path.join(output_path, fname)
        with open(fpath, 'w') as f:
            json.dump(report, f, indent=2)
        print(f"Report saved: {fpath}")
        return fpath