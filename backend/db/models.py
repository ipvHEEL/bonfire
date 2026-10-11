from datetime import datetime

from sqlalchemy import BigInteger, DateTime, ForeignKey, Index, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from db.database import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    username: Mapped[str] = mapped_column(String(32), unique=True)
    display_name: Mapped[str | None] = mapped_column(String(64))
    # NULL у гостей, созданных до появления регистрации: войти под ними нельзя
    password_hash: Mapped[str | None] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    dialogs: Mapped[list["Dialog"]] = relationship(
        secondary="dialog_members", back_populates="members"
    )
    messages: Mapped[list["Message"]] = relationship(back_populates="user")

    @property
    def name(self):
        return self.display_name or self.username


class Dialog(Base):
    __tablename__ = "dialogs"
    __table_args__ = (UniqueConstraint("direct_key", name="uq_dialogs_direct_key"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    title: Mapped[str] = mapped_column(String(128))
    # "group" — общий чат, "direct" — личная переписка двух пользователей
    type: Mapped[str] = mapped_column(String(16), server_default="group")
    # Для личных чатов "меньший_id:больший_id". Уникальность не даёт создать
    # два чата одной пары, даже если оба откроют переписку одновременно
    direct_key: Mapped[str | None] = mapped_column(String(41))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    members: Mapped[list[User]] = relationship(
        secondary="dialog_members", back_populates="dialogs"
    )
    messages: Mapped[list["Message"]] = relationship(
        back_populates="dialog", passive_deletes=True
    )


class DialogMember(Base):
    __tablename__ = "dialog_members"
    # Составной первичный ключ ищет участников диалога,
    # а этот индекс — диалоги пользователя
    __table_args__ = (Index("ix_dialog_members_user_id", "user_id"),)

    dialog_id: Mapped[int] = mapped_column(
        ForeignKey("dialogs.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    joined_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class Message(Base):
    __tablename__ = "messages"
    # История чата читается как "последние N сообщений диалога до id X"
    __table_args__ = (Index("ix_messages_dialog_id_id", "dialog_id", "id"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    dialog_id: Mapped[int] = mapped_column(
        ForeignKey("dialogs.id", ondelete="CASCADE")
    )
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    text: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    user: Mapped[User] = relationship(back_populates="messages", lazy="joined")
    dialog: Mapped[Dialog] = relationship(back_populates="messages")
