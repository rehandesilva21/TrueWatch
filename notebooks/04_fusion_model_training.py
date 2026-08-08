import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import numpy as np
from sklearn.model_selection import train_test_split
from sklearn.metrics import (
    accuracy_score, precision_score, recall_score,
    f1_score, roc_auc_score, confusion_matrix
)
from modules.fusion.lstm_model import build_fusion_model, save_fusion_model
from modules.fusion.mendeley_loader import load_raw_dataframe, build_windows

from modules.fusion.training_plots import (
    plot_training_curves, plot_confusion_matrix, plot_roc_curve,
    plot_metrics_bar, plot_precision_recall_curve
)


def main():
    print("=" * 60)
    print("TrueWatch — Temporal Fusion Model Training")
    print("Dataset: Hossen & Uddin (2025), Mendeley Data")
    print("=" * 60)

    df = load_raw_dataframe()
    X, y = build_windows(df)

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )

    model = build_fusion_model()
    model.summary()

    print("\nTraining...")
    history = model.fit(
        X_train, y_train,
        validation_split=0.15,
        epochs=20,
        batch_size=32,
        verbose=1,
    )

    print("\nEvaluating on held-out test set...")
    y_pred_proba = model.predict(X_test).flatten()
    y_pred       = (y_pred_proba >= 0.5).astype(int)

    acc  = accuracy_score(y_test, y_pred)
    prec = precision_score(y_test, y_pred)
    rec  = recall_score(y_test, y_pred)
    f1   = f1_score(y_test, y_pred)
    auc  = roc_auc_score(y_test, y_pred_proba)
    cm   = confusion_matrix(y_test, y_pred)

    print(f"\nAccuracy:  {acc:.3f}")
    print(f"Precision: {prec:.3f}")
    print(f"Recall:    {rec:.3f}")
    print(f"F1 Score:  {f1:.3f}")
    print(f"ROC AUC:   {auc:.3f}")
    print(f"\nConfusion Matrix:\n{cm}")
    print(f"  True Negatives:  {cm[0][0]}")
    print(f"  False Positives: {cm[0][1]}")
    print(f"  False Negatives: {cm[1][0]}")
    print(f"  True Positives:  {cm[1][1]}")

    # ── Save all evaluation visualizations ──────────────────
    print("\nGenerating evaluation charts...")
    plot_training_curves(history)
    plot_confusion_matrix(cm)
    plot_roc_curve(y_test, y_pred_proba, auc)
    plot_precision_recall_curve(y_test, y_pred_proba)
    plot_metrics_bar({
        "Accuracy":  acc,
        "Precision": prec,
        "Recall":    rec,
        "F1 Score":  f1,
        "ROC AUC":   auc,
    })
    print(f"\nAll charts saved to reports/figures/")

    save_fusion_model(model)
    print("\nModel trained on REAL data (Hossen & Uddin, 2025).")
    print("Note: audio, identity and tab-switch features were not")
    print("available in this dataset and were set to 0 for these")
    print("windows — those modalities were validated separately")
    print("through direct testing of the live TrueWatch pipeline.")


if __name__ == "__main__":
    main()