from pydantic_settings import BaseSettings


class EnvConfig(BaseSettings):
    model_config = {
        "env_file": ".env",
        "env_file_encoding": "utf-8",
        "extra": "allow",
    }
