from pathlib import Path

from pydantic_settings import BaseSettings


class LabelsConfig(BaseSettings):
    ROOT_DIR: Path = Path("/labels")
    size: int = 600

    @property
    def menu_label(self) -> Path:
        return (self.ROOT_DIR / f"menu.{self.size}.png")

    @property
    def wish_list_label(self) -> Path:
        return (self.ROOT_DIR / f"wish.list.{self.size}.png")

    @property
    def wish_new_label(self) -> Path:
        return (self.ROOT_DIR / f"wish.new.{self.size}.png")

    @property
    def closed_gift(self) -> Path:
        return (self.ROOT_DIR / f"gift.closed.{self.size}.png")

    @property
    def opened_gift(self) -> Path:
        return (self.ROOT_DIR / f"gift.opened.{self.size}.png")
