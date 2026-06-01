"""MongoDB Atlas access via pymongo. Returns None from fetch when no MONGODB_URI
is configured, which signals the app to use demo data."""
import os

try:
    from pymongo import MongoClient
    from bson import ObjectId
except Exception:  # pymongo not installed yet
    MongoClient = None
    ObjectId = None

_collection = None


def _connect():
    global _collection
    uri = os.environ.get("MONGODB_URI")
    if not uri:
        return None
    if MongoClient is None:
        raise RuntimeError("pymongo is not installed. Run: pip install -r requirements.txt")
    if _collection is None:
        db_name = os.environ.get("MONGODB_DB", "workingfund")
        _collection = MongoClient(uri)[db_name]["transactions"]
    return _collection


def is_cloud():
    return bool(os.environ.get("MONGODB_URI")) and MongoClient is not None


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
