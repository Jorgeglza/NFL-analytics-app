"""SQLite writer — committed DB mirrors the JSON extracts for easy migration
to a hosted database later."""
import json
import sqlite3

import pandas as pd

from .config import SQLITE_PATH


def write_sqlite(frames: dict, meta: dict) -> None:
    """frames: table_name -> DataFrame. Replaces tables wholesale."""
    SQLITE_PATH.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(SQLITE_PATH)
    try:
        for name, df in frames.items():
            out = df.copy()
            # sqlite can't store pandas Timestamps directly
            for col in out.columns:
                if pd.api.types.is_datetime64_any_dtype(out[col]):
                    out[col] = out[col].dt.strftime("%Y-%m-%d")
            out.to_sql(name, con, if_exists="replace", index=False)
        meta_df = pd.DataFrame(
            [(k, json.dumps(v) if not isinstance(v, str) else v) for k, v in meta.items()],
            columns=["key", "value"],
        )
        meta_df.to_sql("meta", con, if_exists="replace", index=False)
        con.execute("VACUUM")
    finally:
        con.close()
    print(f"wrote {SQLITE_PATH}")
