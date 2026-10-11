from db.calls import call_to_dict
from db.dialogs import dialog_to_dict
from db.messages import message_to_dict
from db.models import Call, Dialog, Message
from schema.connection_manager import manager


# Всё, что сервер присылает по вебсокету, имеет поле "type":
#   message         — новое сообщение
#   dialog          — чат появился или изменился (новый запрос, запрос принят)
#   dialog_removed  — чат удалён (запрос отклонён)
#   call            — звонок начался или изменился (ответили)
#   call_ended      — звонок завершён


async def send_message(member_ids: set[int], message: Message):
    await manager.send_to_users(member_ids, {"type": "message", "message": message_to_dict(message)})


async def send_dialog(dialog: Dialog, last_message: Message | None = None):
    # Название личного чата у каждого своё, поэтому шлём каждому участнику отдельно
    for member in dialog.members:
        await manager.send_to_users(
            {member.id},
            {"type": "dialog", "dialog": dialog_to_dict(dialog, member, last_message)},
        )


async def send_dialog_removed(member_ids: set[int], dialog_id: int):
    await manager.send_to_users(member_ids, {"type": "dialog_removed", "dialog_id": dialog_id})


async def send_call(member_ids: set[int], call: Call):
    await manager.send_to_users(member_ids, {"type": "call", "call": call_to_dict(call)})


async def send_call_ended(member_ids: set[int], call: Call):
    await manager.send_to_users(member_ids, {"type": "call_ended", "call": call_to_dict(call)})

