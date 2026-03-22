import os
import uvicorn

if __name__ == "__main__":
    port   = int(os.getenv("PORT",   "8765"))
    host   =     os.getenv("HOST",   "127.0.0.1")
    reload =     os.getenv("RELOAD", "1") == "1"
    uvicorn.run("app:app", host=host, port=port, reload=reload)
