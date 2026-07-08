try:
    from pymongo import MongoClient
    from bson import ObjectId
except Exception:
    MongoClient = None
    ObjectId = None

# Import the local credentials. Capture any failure so the app can explain, in
# plain words, why it fell back to demo data instead of failing silently.
_import_error = None
try:
    import secret_config
    _URI = (getattr(secret_config, "MONGODB_URI", "") or "").strip()
    _DB_NAME = getattr(secret_config, "MONGODB_DB", "workingfund") or "workingfund"
except Exception as e:
    secret_config = None
    _URI = ""
    _DB_NAME = "workingfund"
    _import_error = e

_collection = None
_conn_error = None


def _is_placeholder(uri):
    """The example secret_config ships an obviously-fake URI; treat it as unset."""
    u = uri or ""
    return "USER:PASSWORD" in u or "xxxxx" in u


def configured():
    """True when a real-looking connection string is present."""
    return bool(_URI) and not _is_placeholder(_URI)


def _connect():
    global _collection
    if not configured() or MongoClient is None:
        return None
    if _collection is None:
        # A short server-selection timeout so a bad URI fails fast (and lands in
        # demo mode with a clear reason) instead of hanging the startup for 30s.
        _collection = MongoClient(_URI, serverSelectionTimeoutMS=6000)[_DB_NAME]["transactions"]
    return _collection


def fetch_all(mission=None):
    """Every cloud transaction (optionally by mission), or None on any problem.

    Never raises: a connection failure is recorded in _conn_error and reported by
    demo_reason(), and the caller falls back to demo data.
    """
    global _conn_error
    if not configured() or MongoClient is None:
        return None
    try:
        col = _connect()
        query = {}
        if mission in ("east", "south"):
            query["mission"] = mission
        docs = list(col.find(query).sort("createdAt", 1))
        _conn_error = None
        return docs
    except Exception as e:
        _conn_error = e
        return None


def delete_tx(tx_id):
    if not configured() or MongoClient is None:
        return
    try:
        _connect().delete_one({"_id": ObjectId(tx_id)})
    except Exception:
        pass


def is_cloud():
    """True when the app is actually reading from MongoDB (not demo data)."""
    return configured() and MongoClient is not None and _conn_error is None


def demo_reason():
    """A plain-language explanation of why the app is in demo mode ('' if it is
    genuinely cloud-connected). Shown at startup and in the review portal."""
    if is_cloud():
        return ""
    if MongoClient is None:
        return "pymongo is not installed. In the local/ folder run: pip install -r requirements.txt"
    if _import_error is not None:
        return ("Could not load local/secret_config.py (%s). Copy secret_config.example.py to "
                "secret_config.py inside the local/ folder and fill in your MongoDB URI." % _import_error)
    if not _URI:
        return "MONGODB_URI is empty in local/secret_config.py. Paste your MongoDB Atlas connection string."
    if _is_placeholder(_URI):
        return ("MONGODB_URI in local/secret_config.py is still the example placeholder. Replace it with "
                "your real Atlas connection string (with the real user and password).")
    if _conn_error is not None:
        return ("Could not connect to MongoDB: %s. Check the password in the URI and that Atlas Network "
                "Access allows this computer (0.0.0.0/0)." % _conn_error)
    return "Not connected to the cloud."
