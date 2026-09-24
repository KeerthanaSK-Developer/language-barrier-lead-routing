from pymongo import MongoClient
from config import MONGODB_URL, DATABASE_NAME

client = MongoClient(MONGODB_URL)
db = client[DATABASE_NAME]

# Collections
users_collection = db.users
leads_collection = db.leads
bds_collection = db.bds
routing_history_collection = db.routing_history
pending_leads_collection = db.pending_leads
call_sessions_collection = db.call_sessions
call_transcripts_collection = db.call_transcripts


def serialize_doc(doc, *, id_field: str | None = "id"):
    """Return a JSON-safe copy of a MongoDB document without `_id`.

    Never exposes ObjectId. If id_field is set and the doc had `_id`,
    copies str(_id) into that field only when it is not already present.
    Pass id_field=None to drop `_id` without adding an id.
    """
    if doc is None:
        return None
    out = {k: v for k, v in doc.items() if k != "_id"}
    if id_field and "_id" in doc and id_field not in out:
        out[id_field] = str(doc["_id"])
    return out
