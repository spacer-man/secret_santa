import pytest

from handlers import buttons
from handlers.main.keyboards import main_menu


def _texts(markup) -> list[str]:
    return [b.text for row in markup.inline_keyboard for b in row]


def test_main_menu_opens_site_in_browser(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("WEBAPP_URL", "https://santa.example.com/")
    markup = main_menu()
    browser = [b for row in markup.inline_keyboard for b in row if b.url]
    assert [b.text for b in browser] == [buttons.OPEN_IN_BROWSER]
    assert browser[0].url == "https://santa.example.com/"
    # The mini app stays the first button
    assert markup.inline_keyboard[0][0].text == buttons.OPEN_APP


def test_main_menu_without_site(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("WEBAPP_URL", "")
    texts = _texts(main_menu())
    assert buttons.OPEN_IN_BROWSER not in texts
    assert buttons.OPEN_APP not in texts
