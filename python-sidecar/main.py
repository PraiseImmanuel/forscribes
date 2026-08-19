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

# The Tauri webview loads the frontend from tauri://localhost (production)
# or http://localhost:1420 (vite dev server). Both need CORS clearance to
# call this sidecar on a different port.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "tauri://localhost",
        "http://localhost:1420",
        "http://127.0.0.1:1420",
    ],
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
