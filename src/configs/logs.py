from pydantic_settings import BaseSettings


class LogsConfig(BaseSettings):
    logs_configuration_path: str = "logging.yaml"
