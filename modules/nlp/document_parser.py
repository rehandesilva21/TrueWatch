import os
import re
import nltk
from nltk.corpus import stopwords
from nltk.tokenize import sent_tokenize, word_tokenize

STOP_WORDS = set(stopwords.words('english'))

# ─── Document readers ──────────────────────────────────────────
def read_pdf(file_path):
    """Extract text from PDF file."""
    try:
        import fitz  # PyMuPDF
        doc  = fitz.open(file_path)
        text = ""
        for page in doc:
            text += page.get_text()
        doc.close()
        return text.strip()
    except Exception as e:
        print(f"PDF read error: {e}")
        return ""

def read_docx(file_path):
    """Extract text from DOCX file."""
    try:
        from docx import Document
        doc   = Document(file_path)
        text  = "\n".join([p.text for p in doc.paragraphs])
        return text.strip()
    except Exception as e:
        print(f"DOCX read error: {e}")
        return ""

def read_txt(file_path):
    """Extract text from plain text file."""
    try:
        with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
            return f.read().strip()
    except Exception as e:
        print(f"TXT read error: {e}")
        return ""

def read_document(file_path):
    """Auto-detect file type and extract text."""
    ext = os.path.splitext(file_path)[1].lower()
    if ext == '.pdf':
        return read_pdf(file_path)
    elif ext in ['.docx', '.doc']:
        return read_docx(file_path)
    elif ext == '.txt':
        return read_txt(file_path)
    else:
        print(f"Unsupported file type: {ext}")
        return ""

# ─── Text cleaning ─────────────────────────────────────────────
def clean_text(text):
    """Clean and normalise text for comparison."""
    # Remove extra whitespace and newlines
    text = re.sub(r'\s+', ' ', text)
    # Remove special characters but keep punctuation
    text = re.sub(r'[^\w\s\.\,\!\?\;\:]', '', text)
    return text.strip().lower()

def split_into_sentences(text):
    """Split text into sentences for granular comparison."""
    try:
        sentences = sent_tokenize(text)
    except Exception:
        sentences = text.split('.')
    return [s.strip() for s in sentences if len(s.strip()) > 20]

def split_into_chunks(text, chunk_size=150):
    """
    Split text into overlapping word chunks.
    Better for catching partial plagiarism.
    """
    words  = text.split()
    chunks = []
    step   = chunk_size // 2  # 50% overlap

    for i in range(0, len(words), step):
        chunk = ' '.join(words[i:i + chunk_size])
        if len(chunk.split()) >= 20:  # minimum chunk size
            chunks.append(chunk)

    return chunks

def remove_stopwords(text):
    """Remove stopwords for TF-IDF comparison."""
    words = word_tokenize(text.lower())
    return ' '.join([w for w in words if w.isalnum() and w not in STOP_WORDS])