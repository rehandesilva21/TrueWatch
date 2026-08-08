import os
import numpy as np
import matplotlib
matplotlib.use("Agg")  # no GUI needed, just save files
import matplotlib.pyplot as plt
import seaborn as sns

OUTPUT_DIR = "reports/figures"
os.makedirs(OUTPUT_DIR, exist_ok=True)

plt.rcParams.update({
    "figure.dpi": 150,
    "savefig.dpi": 150,
    "font.size": 11,
    "axes.titlesize": 13,
    "axes.titleweight": "bold",
})


def plot_training_curves(history, filename="training_curves.jpg"):
    """
    Plots accuracy and loss for train vs validation across epochs.
    This is the standard overfitting/underfitting diagnostic:
    - Overfitting: train keeps improving, val plateaus or worsens
    - Underfitting: both train and val stay poor / plateau early
    """
    fig, axes = plt.subplots(1, 2, figsize=(12, 4.5))

    # Accuracy
    axes[0].plot(history.history["accuracy"], label="Train", linewidth=2, color="#2563eb")
    axes[0].plot(history.history["val_accuracy"], label="Validation", linewidth=2, color="#dc2626")
    axes[0].set_title("Model Accuracy — Train vs Validation")
    axes[0].set_xlabel("Epoch")
    axes[0].set_ylabel("Accuracy")
    axes[0].legend()
    axes[0].grid(alpha=0.3)

    # Loss
    axes[1].plot(history.history["loss"], label="Train", linewidth=2, color="#2563eb")
    axes[1].plot(history.history["val_loss"], label="Validation", linewidth=2, color="#dc2626")
    axes[1].set_title("Model Loss — Train vs Validation")
    axes[1].set_xlabel("Epoch")
    axes[1].set_ylabel("Loss (Binary Crossentropy)")
    axes[1].legend()
    axes[1].grid(alpha=0.3)

    plt.tight_layout()
    path = os.path.join(OUTPUT_DIR, filename)
    plt.savefig(path, format="jpg")
    plt.close()
    print(f"Saved: {path}")

    # Print a plain-English diagnostic
    final_train_acc = history.history["accuracy"][-1]
    final_val_acc    = history.history["val_accuracy"][-1]
    gap = final_train_acc - final_val_acc
    if gap > 0.12:
        verdict = "Possible OVERFITTING — training accuracy notably higher than validation."
    elif final_train_acc < 0.65 and final_val_acc < 0.65:
        verdict = "Possible UNDERFITTING — both training and validation accuracy are low."
    else:
        verdict = "Good fit — training and validation accuracy are reasonably close."
    print(f"Diagnostic: {verdict}")
    return verdict


def plot_confusion_matrix(cm, filename="confusion_matrix.jpg"):
    fig, ax = plt.subplots(figsize=(5.5, 4.5))
    sns.heatmap(
        cm, annot=True, fmt="d", cmap="Blues", cbar=True,
        xticklabels=["Predicted: Normal", "Predicted: Cheating"],
        yticklabels=["Actual: Normal", "Actual: Cheating"],
        annot_kws={"size": 14, "weight": "bold"}, ax=ax
    )
    ax.set_title("Confusion Matrix — Fusion Model (Test Set)")
    plt.tight_layout()
    path = os.path.join(OUTPUT_DIR, filename)
    plt.savefig(path, format="jpg")
    plt.close()
    print(f"Saved: {path}")


def plot_roc_curve(y_test, y_pred_proba, auc_score, filename="roc_curve.jpg"):
    from sklearn.metrics import roc_curve
    fpr, tpr, _ = roc_curve(y_test, y_pred_proba)

    fig, ax = plt.subplots(figsize=(5.5, 5))
    ax.plot(fpr, tpr, linewidth=2.5, color="#2563eb",
            label=f"Fusion Model (AUC = {auc_score:.3f})")
    ax.plot([0, 1], [0, 1], linestyle="--", color="#94a3b8", label="Random classifier")
    ax.set_xlabel("False Positive Rate")
    ax.set_ylabel("True Positive Rate")
    ax.set_title("ROC Curve — Fusion Model")
    ax.legend(loc="lower right")
    ax.grid(alpha=0.3)
    plt.tight_layout()
    path = os.path.join(OUTPUT_DIR, filename)
    plt.savefig(path, format="jpg")
    plt.close()
    print(f"Saved: {path}")


def plot_metrics_bar(metrics_dict, filename="metrics_summary.jpg"):
    """
    metrics_dict: {"Accuracy": 0.791, "Precision": 0.771, ...}
    """
    names  = list(metrics_dict.keys())
    values = list(metrics_dict.values())
    colors = ["#2563eb", "#16a34a", "#d97706", "#7c3aed", "#dc2626"]

    fig, ax = plt.subplots(figsize=(7, 4.5))
    bars = ax.bar(names, values, color=colors[:len(names)])
    ax.set_ylim(0, 1.0)
    ax.set_ylabel("Score")
    ax.set_title("Fusion Model — Evaluation Metrics Summary")
    ax.grid(axis="y", alpha=0.3)

    for bar, val in zip(bars, values):
        ax.text(bar.get_x() + bar.get_width()/2, val + 0.02,
                f"{val:.3f}", ha="center", fontsize=10, fontweight="bold")

    plt.tight_layout()
    path = os.path.join(OUTPUT_DIR, filename)
    plt.savefig(path, format="jpg")
    plt.close()
    print(f"Saved: {path}")


def plot_precision_recall_curve(y_test, y_pred_proba, filename="precision_recall_curve.jpg"):
    from sklearn.metrics import precision_recall_curve, average_precision_score
    precision, recall, _ = precision_recall_curve(y_test, y_pred_proba)
    ap = average_precision_score(y_test, y_pred_proba)

    fig, ax = plt.subplots(figsize=(5.5, 5))
    ax.plot(recall, precision, linewidth=2.5, color="#7c3aed",
            label=f"Fusion Model (AP = {ap:.3f})")
    ax.set_xlabel("Recall")
    ax.set_ylabel("Precision")
    ax.set_title("Precision-Recall Curve — Fusion Model")
    ax.legend(loc="lower left")
    ax.grid(alpha=0.3)
    plt.tight_layout()
    path = os.path.join(OUTPUT_DIR, filename)
    plt.savefig(path, format="jpg")
    plt.close()
    print(f"Saved: {path}")