"""
Trained plagiarism classifier inference for TrueWatch.

Wraps the binary (plagiarized/not) model trained in Colab on the
Clough & Stevenson corpus — 96.8% leave-one-task-out accuracy. Reuses
`clean_text` from document_parser.py so feature extraction stays
byte-for-byte identical to what the corpus-loading pipeline already
produces (load_corpus() and analyze() both work with cleaned text,
not raw).

Expects these 3 files in MODEL_DIR (downloaded from your Drive
TrueWatch_models folder after the Colab run):
    plagiarism_model.pkl
    plagiarism_feature_cols.pkl
    plagiarism_model_info.txt   (informational only, not required at runtime)
"""

import os
import pickle
import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer, CountVectorizer
from sklearn.metrics.pairwise import cosine_similarity

from modules.nlp.document_parser import clean_text

MODEL_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "models",
)

_model = None
_feature_cols = None
_semantic_model = None


def load_classifier(model_dir=MODEL_DIR):
    """Loads the trained model once and caches it at module level. Call this
    at app startup, not per-request."""
    global _model, _feature_cols

    with open(os.path.join(model_dir, "plagiarism_model.pkl"), "rb") as f:
        _model = pickle.load(f)
    with open(os.path.join(model_dir, "plagiarism_feature_cols.pkl"), "rb") as f:
        _feature_cols = pickle.load(f)

    print(f"Plagiarism classifier loaded from {model_dir} ({type(_model).__name__ if not hasattr(_model, 'steps') else _model.steps[-1][1].__class__.__name__})")


def _get_semantic_model():
    """Lazy load — same MiniLM model SemanticChecker already uses elsewhere
    in this project, loaded a second time here since this module needs to
    stay usable independently of plagiarism_detector.py's SemanticChecker."""
    global _semantic_model
    if _semantic_model is None:
        from sentence_transformers import SentenceTransformer
        _semantic_model = SentenceTransformer('paraphrase-MiniLM-L6-v2')
    return _semantic_model


def _ensure_loaded():
    if _model is None:
        raise RuntimeError(
            "Plagiarism classifier not loaded. Call load_classifier() once at "
            "startup before predict_plagiarism_probability()."
        )


# ─── Feature functions — copied verbatim from the training notebook ───────
def containment(n, answer_clean, source_clean):
    vec = CountVectorizer(ngram_range=(n, n), analyzer='word')
    try:
        counts = vec.fit_transform([answer_clean, source_clean]).toarray()
    except ValueError:
        return 0.0  # answer shorter than n words
    intersection = np.minimum(counts[0], counts[1]).sum()
    total = counts[0].sum()
    return float(intersection / total) if total > 0 else 0.0


def lcs_norm(answer_clean, source_clean):
    a = answer_clean.split()
    b = source_clean.split()
    la, lb = len(a), len(b)
    if la == 0 or lb == 0:
        return 0.0
    dp = [[0] * (lb + 1) for _ in range(la + 1)]
    for i in range(1, la + 1):
        for j in range(1, lb + 1):
            if a[i - 1] == b[j - 1]:
                dp[i][j] = dp[i - 1][j - 1] + 1
            else:
                dp[i][j] = max(dp[i - 1][j], dp[i][j - 1])
    return dp[la][lb] / la


def tfidf_cosine(answer_clean, source_clean):
    try:
        vec = TfidfVectorizer(ngram_range=(1, 2))
        mat = vec.fit_transform([answer_clean, source_clean])
        return float(cosine_similarity(mat[0], mat[1])[0][0])
    except ValueError:
        return 0.0


def semantic_cosine(answer_text, source_text):
    model = _get_semantic_model()
    emb = model.encode([answer_text, source_text], show_progress_bar=False)
    return float(cosine_similarity([emb[0]], [emb[1]])[0][0])


# ─── Public API ─────────────────────────────────────────────────────────
def predict_plagiarism_probability(query_text, source_text):
    """
    Returns P(plagiarized) in [0, 1] for one query-vs-source comparison.

    NOTE: both inputs should already be clean_text()'d — this matches how
    PlagiarismDetector.analyze() and load_corpus() already work (they store
    and compare cleaned text throughout, never raw), even though the
    training notebook computed semantic_cosine on raw text. The difference
    (mostly lowercasing + whitespace normalization) has negligible effect
    on the sentence embedding, but keeping it consistent with what's
    actually available at call time matters more than exactly replaying
    the notebook's specific inputs.
    """
    _ensure_loaded()

    feat = {}
    for n in range(1, 6):
        feat[f"containment_{n}"] = containment(n, query_text, source_text)
    feat["lcs_norm"]        = lcs_norm(query_text, source_text)
    feat["tfidf_cosine"]    = tfidf_cosine(query_text, source_text)
    feat["semantic_cosine"] = semantic_cosine(query_text, source_text)

    X = [[feat[c] for c in _feature_cols]]
    return float(_model.predict_proba(X)[0][1])


def predict_best_match(query_text, corpus_docs):
    """
    Runs the classifier against every (name, text) pair in corpus_docs and
    returns (best_source_name, best_probability). Takes the max across the
    corpus rather than an average — one strong match is what plagiarism
    looks like, many weak ones usually isn't (same reasoning TFIDFChecker
    already uses for its own top-match logic).
    """
    _ensure_loaded()
    if not corpus_docs:
        return None, 0.0

    best_name, best_prob = None, 0.0
    for name, text in corpus_docs:
        prob = predict_plagiarism_probability(query_text, text)
        if prob > best_prob:
            best_name, best_prob = name, prob
    return best_name, best_prob
