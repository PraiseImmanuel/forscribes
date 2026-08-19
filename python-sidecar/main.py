"""ForScribe local sidecar.

A FastAPI server bound to 127.0.0.1 only - never reachable from the network.
The Tauri app is the sole client, talking to it over plain HTTP on localhost.
This is the ONLY place in the app that will ever grow ML dependencies
(transcription, embeddings, clustering, rating) - the Rust/React side stays
thin and just proxies to this process.
"""
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from db import get_db_path, init_db
from routes_transcription import router as transcription_router
from routes_grouping import router as grouping_router
from routes_topic import router as topic_router
from routes_export import router as export_router

PORT = 17652


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db(get_db_path())
    yield


app = FastAPI(title="ForScribe Sidecar", lifespan=lifespan)

# Wide open on purpose, not an oversight: this server only ever binds
# 127.0.0.1, so nothing outside this machine can reach it regardless of
# what CORS allows, and it holds no cookies/session state a hostile page
# could ride along on. Previously this pinned an exact allowlist (mirroring
# the origins Tauri/the dev server are *supposed* to use), which turned out
# to be exactly the kind of thing this app's real production WebView2 build
# didn't match - the sidecar would log a clean 200 OK for every request
# while the browser silently discarded the response before JS ever saw it,
# which looked identical to the sidecar being unreachable. Matching the
# real origin string exactly was a game of whack-a-mole not worth playing
# when the actual security boundary here is the network binding above, not
# CORS - so there's nothing left to get wrong.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {"status": "ok", "db_path": str(get_db_path())}


app.include_router(transcription_router)
app.include_router(grouping_router)
app.include_router(topic_router)
app.include_router(export_router)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=PORT, log_level="info")
