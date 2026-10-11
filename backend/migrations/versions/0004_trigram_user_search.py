"""trigram indexes for user search

Revision ID: 0004
Revises: 0003
Create Date: 2026-10-11 06:20:00

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = '0004'
down_revision: Union[str, Sequence[str], None] = '0003'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # pg_trgm разбивает строки на тройки символов: по ним GIN-индекс
    # находит совпадения по подстроке без перебора всей таблицы
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
    op.create_index(
        'ix_users_username_trgm', 'users', ['username'],
        postgresql_using='gin', postgresql_ops={'username': 'gin_trgm_ops'},
    )
    op.create_index(
        'ix_users_display_name_trgm', 'users', ['display_name'],
        postgresql_using='gin', postgresql_ops={'display_name': 'gin_trgm_ops'},
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index('ix_users_display_name_trgm', table_name='users')
    op.drop_index('ix_users_username_trgm', table_name='users')
