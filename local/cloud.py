"""MongoDB Atlas access via pymongo. Returns None from fetch when no MONGODB_URI
is configured, which signals the app to use demo data.

The connection string is read from local/secret_config.py (a plain variable in
code, gitignored) rather than an environment variable. Copy
secret_config.example.py to secret_config.py and paste your string in."""

try:
    from pymongo import MongoClient
    from bson import ObjectId
except Exception:  # pymongo not installed yet
    MongoClient = None
    ObjectId = None

try:
    import secret_config
    _URI = (getattr(secret_config, "MONGODB_URI", "") or "").strip()
    _DB_NAME = getattr(secret_config, "MONGODB_DB", "workingfund") or "workingfund"
except Exception:  # secret_config.py not created yet -> demo mode
    _URI = ""
    _DB_NAME = "workingfund"

_collection = None


def _connect():
    global _collection
    if not _URI:
        return None
    if MongoClient is None:
        raise RuntimeError("pymongo is not installed. Run: pip install -r requirements.txt")
    if _collection is None:
        _collection = MongoClient(_URI)[_DB_NAME]["transactions"]
    return _collection


def is_cloud():
    return bool(_URI) and MongoClient is not None


def fetch_all(mission=None):
    """Return ALL transaction docs (optionally filtered to one mission), or None
    if no cloud is configured (demo). The review app shows everything on the
    cloud, since approve/delete now remove documents entirely."""
    col = _connect()
    if col is None:
        return None
    query = {}
    if mission in ("east", "south"):
        query["mission"] = mission
    return list(col.find(query).sort("createdAt", 1))


def delete_tx(tx_id):
    """Delete the whole document (its receipts + signature live inside it, so they
    go with it). Called on both approve and delete."""
    col = _connect()
    if col is None:
        return
    col.delete_one({"_id": ObjectId(tx_id)})
