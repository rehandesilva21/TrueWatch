import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from modules.nlp.plagiarism_detector import PlagiarismDetector, save_to_corpus
from modules.nlp.document_parser import read_document

def create_test_documents():
    os.makedirs("data/corpus",    exist_ok=True)
    os.makedirs("data/processed", exist_ok=True)
    os.makedirs("os.path.join",       exist_ok=True)

    # ── Reference document (corpus) ───────────────────────
    ref_text = """
    Machine learning is a subset of artificial intelligence that enables
    computers to learn from data without being explicitly programmed.
    Deep learning uses neural networks with multiple layers to learn
    complex patterns in large datasets. Convolutional neural networks
    are particularly effective for image recognition tasks in computer
    vision applications. Recurrent neural networks are designed to work
    with sequential data such as text and time series data streams.
    Transfer learning allows models trained on large datasets to be
    fine-tuned for specific tasks with significantly less training data.
    Natural language processing enables computers to understand and
    generate human language with increasing accuracy and fluency.
    Supervised learning uses labeled training data to train models to
    make accurate predictions on new unseen data samples. Unsupervised
    learning discovers hidden patterns in data without labeled examples.
    Reinforcement learning trains agents to make decisions by rewarding
    desired behaviours and penalising undesired ones over many episodes.
    Support vector machines find the optimal hyperplane that separates
    classes in high dimensional feature spaces for classification tasks.
    Random forests combine multiple decision trees to improve prediction
    accuracy and reduce overfitting on training data significantly.
    Gradient boosting builds models sequentially where each model
    corrects the errors made by the previous model in the sequence.
    Feature engineering transforms raw data into meaningful input
    representations that improve the performance of machine learning models.
    Cross validation evaluates model generalisation by testing on
    multiple held out subsets of the available training data.
    """

    # ── Test 1: clearly plagiarised (copied + minor edits) ─
    plagiarised_text = """
    Machine learning is a subset of artificial intelligence that enables
    computers to learn from data without being explicitly programmed.
    This technology has transformed many industries worldwide. Deep
    learning uses neural networks with multiple layers to learn complex
    patterns in large datasets of various types. Convolutional neural
    networks are particularly effective for image recognition tasks in
    computer vision applications across many domains. Recurrent neural
    networks are designed to work with sequential data such as text and
    time series data streams in real time systems. Transfer learning
    allows models trained on large datasets to be fine-tuned for
    specific tasks with significantly less training data requirements.
    Natural language processing enables computers to understand and
    generate human language with increasing accuracy and fluency today.
    Supervised learning uses labeled training data to train models to
    make accurate predictions on new unseen data samples efficiently.
    Unsupervised learning discovers hidden patterns in data without
    requiring labeled examples from domain experts or annotators.
    Random forests combine multiple decision trees to improve prediction
    accuracy and reduce overfitting on training data significantly more.
    """

    # ── Test 2: completely original content ───────────────
    original_text = """
    Quantum computing represents a fundamentally different approach to
    information processing compared to classical computing paradigms.
    Unlike classical computers that use binary bits representing zero
    or one, quantum computers use qubits that can exist in superposition
    of both states simultaneously due to quantum mechanical principles.
    This property allows quantum computers to solve certain computational
    problems exponentially faster than the best known classical algorithms.
    Quantum entanglement enables qubits to be correlated instantaneously
    regardless of the physical distance separating them in space.
    Shor's algorithm demonstrates that quantum computers can factor
    large integers in polynomial time which has major implications for
    modern cryptographic systems based on integer factorisation hardness.
    Grover's search algorithm provides a quadratic speedup over classical
    brute force search algorithms for unstructured database problems.
    Quantum error correction is necessary because qubits are extremely
    fragile and susceptible to decoherence from environmental noise.
    Current quantum computers are considered noisy intermediate scale
    quantum devices that have limited qubit counts and high error rates.
    Topological qubits may provide more stable quantum computation by
    encoding information in topological properties rather than physical
    states of individual particles in the quantum system architecture.
    """

    ref_path  = "data/corpus/reference_ml.txt"
    plag_path = "os.path.join.test_plagiarised.txt"
    orig_path = "os.path.join.test_original.txt"

    with open(ref_path,  'w') as f: f.write(ref_text)
    with open(plag_path, 'w') as f: f.write(plagiarised_text)
    with open(orig_path, 'w') as f: f.write(original_text)

    print("Test documents created.")
    return plag_path, orig_path

if __name__ == "__main__":
    print("=" * 60)
    print("TrueWatch — Model 3 NLP Plagiarism Detection Test")
    print("=" * 60)

    # Create test documents
    plag_path, orig_path = create_test_documents()

    detector = PlagiarismDetector()

    # Test 1: plagiarised document
    print("\n[TEST 1] Plagiarised document:")
    report1 = detector.analyze(plag_path, use_semantic=True)
    detector.save_report(report1)

    print("\n" + "─" * 50)

    # Test 2: original document
    print("\n[TEST 2] Original document:")
    report2 = detector.analyze(orig_path, use_semantic=True)
    detector.save_report(report2)

    print("\n" + "=" * 60)
    print("SUMMARY:")
    print(f"  Plagiarised doc originality : {report1['originality']}% "
          f"[{report1['risk_level']}]")
    print(f"  Original doc originality    : {report2['originality']}% "
          f"[{report2['risk_level']}]")
    print("=" * 60)