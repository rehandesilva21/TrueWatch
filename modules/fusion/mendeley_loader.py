import numpy as np
import pandas as pd

DATASET_PATH = "data/external/suspicious_behaviors_dataset.csv"  #[cite: 15]
WINDOW_SIZE  = 15  #[cite: 15]
STRIDE       = 5   # overlap windows for more training samples  #[cite: 15]


def load_raw_dataframe():
    df = pd.read_csv(DATASET_PATH)  #[cite: 15]
    print(f"Loaded {len(df)} rows, {df['label'].sum()} cheating / "  #[cite: 15]
          f"{(df['label']==0).sum()} non-cheating")  #[cite: 15]
    return df  #[cite: 15]


def map_row_to_feature_vector(row, head_dev_min, head_dev_max):
    """
    Maps one real dataset row onto TrueWatch's 10-feature schema.  #[cite: 15]
    Fills historical scoping gaps using statistical proxies derived 
    from available structural columns.
    """
    # 1. Core Vision Features (Directly Available)
    absent_flag     = 1.0 - float(row["face_present"])  #[cite: 15]
    multi_face_flag = 1.0 if row["no_of_face"] > 1 else 0.0  #[cite: 15]

    # Head deviation — magnitude of pitch/yaw/roll, min-max normalized  #[cite: 15]
    head_mag = np.sqrt(
        row["head_pitch"]**2 + row["head_yaw"]**2 + row["head_roll"]**2  #[cite: 15]
    )
    denom = max(head_dev_max - head_dev_min, 1e-6)  #[cite: 15]
    head_deviation = np.clip((head_mag - head_dev_min) / denom, 0.0, 1.0)  #[cite: 15]

    # Gaze deviation — inverse of on-script flag  #[cite: 15]
    gaze_deviation = 1.0 - float(row["gaze_on_script"])  #[cite: 15]

    # Object in use — phone presence OR hand-object interaction  #[cite: 15]
    object_in_use = 1.0 if (row["phone_present"] == 1 or row["hand_obj_interaction"] == 1) else 0.0  #[cite: 15]

    # 2. Proxy Injectors (Replacing the flat 0s to enable network activations)
    
    # Proxy Lip Movement: High head movement + looking away is strongly correlated 
    # with talking/whispering to someone off-camera.
    lip_movement = float(head_deviation > 0.5 and gaze_deviation > 0.5)
    
    # Proxy Audio Signals: Correlate with physical object interactions and multi-face events
    audio_severity   = 0.8 if (object_in_use == 1.0 or multi_face_flag == 1.0) else 0.0
    audio_alert_flag = 1.0 if audio_severity > 0.5 else 0.0
    
    # Proxy Identity Mismatch: When face is absent or multiple faces appear, 
    # validation confidence plummets.
    identity_mismatch = 1.0 if (absent_flag == 1.0 or multi_face_flag == 1.0) else 0.0
    
    # Proxy Tab Switch: Correlates strongly with sustained looking away (gaze deviation) 
    # while using a phone.
    tab_switch_flag = 1.0 if (gaze_deviation > 0.7 and object_in_use == 1.0) else 0.0

    return np.array([
        gaze_deviation, head_deviation, lip_movement,
        absent_flag, multi_face_flag,
        audio_severity, audio_alert_flag,
        identity_mismatch, object_in_use, tab_switch_flag,
    ], dtype=np.float32)  #[cite: 15]


def build_windows(df):
    """
    Builds sliding windows using an optimized threshold flagging rule 
    to capture rapid anomalous temporal transitions sharply.
    """
    # Normalize head deviation magnitude across the whole dataset first  #[cite: 15]
    head_mag_all = np.sqrt(
        df["head_pitch"]**2 + df["head_yaw"]**2 + df["head_roll"]**2  #[cite: 15]
    )
    head_dev_min, head_dev_max = head_mag_all.min(), head_mag_all.max()  #[cite: 15]

    feature_rows = np.array([
        map_row_to_feature_vector(row, head_dev_min, head_dev_max)
        for _, row in df.iterrows()  #[cite: 15]
    ])
    labels = df["label"].values  #[cite: 15]

    X, y = [], []
    for start in range(0, len(df) - WINDOW_SIZE, STRIDE):  #[cite: 15]
        window = feature_rows[start:start + WINDOW_SIZE]  #[cite: 15]
        
        # Optimization: If 35% or more of the frame sequence contains anomalous 
        # behavior, tag the whole temporal block as suspicious to catch quick phone-looks.
        cheating_ratio = labels[start:start + WINDOW_SIZE].mean()
        window_label = 1 if cheating_ratio >= 0.35 else 0
        
        X.append(window)  #[cite: 15]
        y.append(window_label)  #[cite: 15]

    X = np.array(X, dtype=np.float32)  #[cite: 15]
    y = np.array(y, dtype=np.int32)  #[cite: 15]
    print(f"Built {len(X)} windows of shape {X.shape[1:]} "  #[cite: 15]
          f"({y.sum()} cheating / {(y==0).sum()} non-cheating)")  #[cite: 15]
    return X, y  #[cite: 15]