import os
from flask_sqlalchemy import SQLAlchemy
from datetime import datetime
from enum import Enum as PyEnum
import json

db = SQLAlchemy()

def init_db(app):
    # TRUEWATCH_DB_URI lets the database target be overridden without
    # code changes — used specifically by the automated test suite
    # (Chapter 7) to point the app at an isolated in-memory SQLite
    # database instead of the real MySQL instance, so tests never touch
    # production/development data and can run without a MySQL server
    # present at all. Falls back to the original hardcoded MySQL URI for
    # normal application use, so this is purely additive.
    app.config['SQLALCHEMY_DATABASE_URI'] = os.environ.get(
        'TRUEWATCH_DB_URI', 'mysql+pymysql://root:@localhost/truewatch'
    )
    app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
    db.init_app(app)
    with app.app_context():
        db.create_all()
        _seed_admin(app)
    print("Database connected and tables created.")

def _seed_admin(app):
    """Create default admin account if none exists."""
    with app.app_context():
        from backend.models import User, UserRole
        if not User.query.filter_by(role=UserRole.ADMIN).first():
            from werkzeug.security import generate_password_hash
            admin = User(
                name       = "Admin",
                email      = "admin@truewatch.com",
                password   = generate_password_hash("admin123"),
                role       = UserRole.ADMIN,
            )
            db.session.add(admin)
            db.session.commit()
            print("Default admin created: admin@truewatch.com / admin123")