class UserServiceException(Exception):
    pass
class UserIsNotRegisteredError(UserServiceException):
    pass
class UserAlreadyRegisteredError(UserServiceException):
    pass
