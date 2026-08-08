import os
from flask_sqlalchemy import SQLAlchemy
from datetime import datetime
from enum import Enum as PyEnum
import json

db = SQLAlchemy()

def init_db(app):
    app.config['SQLALCHEMY_DATABASE_URI'] = (
        'mysql+pymysql://root:@localhost/truewatch'
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