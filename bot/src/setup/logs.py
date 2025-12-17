import logging
import logging.config
import yaml
from pathlib import Path

from configs.logs import LogsConfig


def setup_logs() -> None:
    logs_config_path = LogsConfig().logs_configuration_path
    config_text = Path(logs_config_path).read_text()
    config = yaml.safe_load(config_text)
    logging.config.dictConfig(config)
