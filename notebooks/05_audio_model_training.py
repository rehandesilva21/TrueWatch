import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import numpy as np
from sklearn.model_selection import train_test_split
from sklearn.metrics import (
    accuracy_score, precision_score, recall_score,
    f1_score, confusion_matrix, classification_report
)
from modules.audio.esc50_loader import build_dataset, TARGET_CLASSES
from modules.audio.cnn_model import build_audio_cnn, save_audio_model
from modules.fusion.training_plots import plot_training_curves, plot_metrics_bar
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import seaborn as sns


def plot_audio_confusion_matrix(cm, class_names, filename="audio_confusion_matrix.jpg"):
    fig, ax = plt.subplots(figsize=(6, 5))
    sns.heatmap(cm, annot=True, fmt="d", cmap="Purples", cbar=True,
                xticklabels=class_names, yticklabels=class_names,
                annot_kws={"size": 12, "weight": "bold"}, ax=ax)
    ax.set_title("Confusion Matrix — Audio CNN (Test Set)")
    ax.set_xlabel("Predicted")
    ax.set_ylabel("Actual")
    plt.tight_layout()
    path = os.path.join("reports/figures", filename)
    os.makedirs("reports/figures", exist_ok=True)
    plt.savefig(path, format="jpg")
    plt.close()
    print(f"Saved: {path}")


def main():
    print("=" * 60)
    print("TrueWatch — Audio CNN Training")
    print("Dataset: ESC-50 (Piczak, 2015)")
    print("=" * 60)

    X, y = build_dataset()

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )

    model = build_audio_cnn()
    model.summary()

    print("\nTraining...")
    history = model.fit(
        X_train, y_train,
        validation_split=0.15,
        epochs=25,
        batch_size=16,
        verbose=1,
    )

    print("\nEvaluating on held-out test set...")
    y_pred_proba = model.predict(X_test)
    y_pred       = np.argmax(y_pred_proba, axis=1)

    acc  = accuracy_score(y_test, y_pred)
    prec = precision_score(y_test, y_pred, average="macro", zero_division=0)
    rec  = recall_score(y_test, y_pred, average="macro", zero_division=0)
    f1   = f1_score(y_test, y_pred, average="macro", zero_division=0)
    cm   = confusion_matrix(y_test, y_pred)

    print(f"\nAccuracy:  {acc:.3f}")
    print(f"Precision (macro): {prec:.3f}")
    print(f"Recall (macro):    {rec:.3f}")
    print(f"F1 Score (macro):  {f1:.3f}")
    print(f"\nConfusion Matrix:\n{cm}")
    print(f"\nPer-class report:\n{classification_report(y_test, y_pred, target_names=TARGET_CLASSES, zero_division=0)}")

    print("\nGenerating evaluation charts...")
    plot_training_curves(history, filename="audio_training_curves.jpg")
    plot_audio_confusion_matrix(cm, TARGET_CLASSES)
    plot_metrics_bar({
        "Accuracy":  acc,
        "Precision": prec,
        "Recall":    rec,
        "F1 Score":  f1,
    }, filename="audio_metrics_summary.jpg")

    save_audio_model(model)
    print("\nModel trained on REAL data (ESC-50, Piczak, 2015).")
    print("Note: ESC-50 has no native 'whisper' or generic 'speech' class;")
    print("closest available categories were mapped onto TrueWatch's exam-")
    print("relevant taxonomy. Whisper detection remains rule-based, validated")
    print("through direct testing, as documented in the project report.")


if __name__ == "__main__":
    main()