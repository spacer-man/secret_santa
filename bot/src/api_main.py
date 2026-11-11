import os

import uvicorn

import setup

if __name__ == "__main__":
    setup.setup_logs()
    uvicorn.run(
        "api.app:app",
        host="0.0.0.0",
        port=int(os.getenv("API_PORT") or 8000),
        proxy_headers=True,
        forwarded_allow_ips="*",
        log_config=None,
    )
