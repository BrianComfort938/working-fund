try:
    from pymongo import MongoClient
    from bson import ObjectId
except Exception:
    MongoClient = None
    ObjectId = None

try:
    import secret_config
    _URI = (getattr(secret_config, "MONGODB_URI", "") or "").strip()
    _DB_NAME = getattr(secret_config, "MONGODB_DB", "workingfund") or "workingfund"
except Exception:
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
    col = _connect()
    if col is None:
        return None
    query = {}
    if mission in ("east", "south"):
        query["mission"] = mission
    return list(col.find(query).sort("createdAt", 1))


def delete_tx(tx_id):
    col = _connect()
    if col is None:
        return
    col.delete_one({"_id": ObjectId(tx_id)})
