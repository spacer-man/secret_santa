import enum


class Scenes(enum.StrEnum):
    REGISTRATION = "registration"
    CONFIRM_TIMEZONE = "confirm_timezone"
    WISHING = "wishing"
    CONFIRM_NEW_WISH = "confirm_new_wish"
    WISHES_LIST = "wishes_list"


MESSAGES_FSM_KEY = "scene_messages"
