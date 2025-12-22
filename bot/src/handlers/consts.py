import enum


class Scenes(enum.StrEnum):
    REGISTRATION = "registration"
    CONFIRM_TIMEZONE = "confirm_timezone"
    WISHING = "wishing"
    WISHES_LIST = "wishes_list"


MESSAGES_FSM_KEY = "scene_messages"
