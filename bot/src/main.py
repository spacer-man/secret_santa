import asyncio
import logging

from aiogram import Bot, Dispatcher
from aiogram.types import MenuButtonWebApp, WebAppInfo
from aiogram.webhook.aiohttp_server import SimpleRequestHandler, setup_application
from aiohttp import web

import db
import setup
from configs.bot import WEBHOOK_HOST, WEBHOOK_PATH, WEBHOOK_PORT, WebhookConfig
from configs.webapp import WebAppConfig

log = logging.getLogger()


async def setup_menu_button(bot: Bot) -> None:
    """The button next to the message field opens the mini app"""
    if not (url := WebAppConfig().url_for()):
        return None
    try:
        await bot.set_chat_menu_button(
            menu_button=MenuButtonWebApp(text="🎄 Санта", web_app=WebAppInfo(url=url))
        )
    except Exception:
        log.warning("Failed to set the menu button", exc_info=True)


async def run_webhook(
    bot: Bot,
    dp: Dispatcher,
    config: WebhookConfig,
    port: int = WEBHOOK_PORT,
) -> None:
    secret = config.secret.get_secret_value() or None
    await bot.set_webhook(
        url=config.url, secret_token=secret, allowed_updates=dp.resolve_used_update_types()
    )

    app = web.Application()
    SimpleRequestHandler(
        dispatcher=dp,
        bot=bot,
        secret_token=secret,
    ).register(app, path=WEBHOOK_PATH)
    setup_application(app, dp, bot=bot)

    runner = web.AppRunner(app)
    await runner.setup()
    await web.TCPSite(runner, host=WEBHOOK_HOST, port=port).start()
    log.info(f"Webhook is listening on :{port}{WEBHOOK_PATH}")
    try:
        await asyncio.Event().wait()
    finally:
        await runner.cleanup()


async def main():
    await db.setup_relations()

    bg_tasks = setup.setup_background_tasks()
    bg_tasks.start()

    bot = setup.bot()
    dp = setup.dispatcher()
    await setup_menu_button(bot)

    webhook = WebhookConfig()
    try:
        if webhook.url:
            await run_webhook(bot, dp, webhook)
        else:
            await bot.delete_webhook()
            await dp.start_polling(bot)
    except KeyboardInterrupt:
        log.info("Stop bot...")
    except Exception as err:
        log.exception("Bot error: %s", err)


if __name__ == "__main__":
    setup.setup_logs()
    asyncio.run(main())
