
import os
import uuid
from datetime import datetime, timedelta
from decimal import Decimal, InvalidOperation
from functools import wraps

import jwt
import mysql.connector
from flask import Flask, request, jsonify, g
from flask_cors import CORS
from werkzeug.security import generate_password_hash, check_password_hash
from dotenv import load_dotenv

from config import get_db_connection

load_dotenv()

app = Flask(__name__)
CORS(app)

JWT_SECRET = os.getenv("JWT_SECRET", "QPay_Local_Dev_Secret_2026_ChangeThis")


def response(message, status=200, **extra):
    return jsonify({"message": message, **extra}), status


def get_token_user():
    header = request.headers.get("Authorization", "")
    if not header.startswith("Bearer "):
        return None

    token = header.split(" ", 1)[1]

    try:
        return jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
    except jwt.InvalidTokenError:
        return None


def login_required(role=None):
    def decorator(function):
        @wraps(function)
        def wrapper(*args, **kwargs):
            user = get_token_user()

            if not user:
                return response("Please log in again.", 401)

            if role and user.get("role") != role:
                return response("You are not authorized for this action.", 403)

            g.user = user
            return function(*args, **kwargs)

        return wrapper
    return decorator


def make_token(user_id, role):
    return jwt.encode(
        {
            "user_id": user_id,
            "role": role,
            "exp": datetime.utcnow() + timedelta(hours=24)
        },
        JWT_SECRET,
        algorithm="HS256"
    )


@app.route("/")
def home():
    return response("QPay API is running.")


@app.route("/api/health")
def health():
    return response("Backend connected.")


@app.route("/api/register", methods=["POST"])
def register():
    data = request.get_json() or {}

    full_name = data.get("full_name", "").strip()
    email = data.get("email", "").strip().lower()
    password = data.get("password", "")
    role = data.get("role", "").strip().lower()

    if not full_name or not email or not password:
        return response("Please fill in all fields.", 400)

    if role not in ["customer", "merchant"]:
        return response("Invalid account type.", 400)

    if len(password) < 6:
        return response("Password must contain at least 6 characters.", 400)

    db = None
    cursor = None

    try:
        db = get_db_connection()
        cursor = db.cursor()

        password_hash = generate_password_hash(password)

        cursor.execute(
            """
            INSERT INTO users (full_name, email, password_hash, role)
            VALUES (%s, %s, %s, %s)
            """,
            (full_name, email, password_hash, role)
        )

        user_id = cursor.lastrowid

        cursor.execute(
            "INSERT INTO wallets (user_id, balance) VALUES (%s, %s)",
            (user_id, 0)
        )

        db.commit()

        return response("Registration successful.", 201)

    except mysql.connector.IntegrityError:
        if db:
            db.rollback()
        return response("This email is already registered.", 409)

    except Exception as error:
        if db:
            db.rollback()
        print("Registration error:", error)
        return response("Registration failed.", 500)

    finally:
        if cursor:
            cursor.close()
        if db:
            db.close()


@app.route("/api/login", methods=["POST"])
def login():
    data = request.get_json() or {}

    email = data.get("email", "").strip().lower()
    password = data.get("password", "")

    db = None
    cursor = None

    try:
        db = get_db_connection()
        cursor = db.cursor(dictionary=True)

        cursor.execute(
            """
            SELECT user_id, full_name, email, password_hash, role, is_active
            FROM users
            WHERE email = %s
            """,
            (email,)
        )

        user = cursor.fetchone()

        if not user or not check_password_hash(user["password_hash"], password):
            return response("Invalid email or password.", 401)

        if not user["is_active"]:
            return response("Your account is inactive.", 403)

        token = make_token(user["user_id"], user["role"])

        return jsonify({
            "message": "Login successful.",
            "token": token,
            "user": {
                "user_id": user["user_id"],
                "full_name": user["full_name"],
                "email": user["email"],
                "role": user["role"]
            }
        })

    except Exception as error:
        print("Login error:", error)
        return response("Login failed.", 500)

    finally:
        if cursor:
            cursor.close()
        if db:
            db.close()


@app.route("/api/wallet", methods=["GET"])
@login_required()
def get_wallet():
    db = None
    cursor = None

    try:
        db = get_db_connection()
        cursor = db.cursor(dictionary=True)

        cursor.execute(
            "SELECT balance FROM wallets WHERE user_id = %s",
            (g.user["user_id"],)
        )

        wallet = cursor.fetchone()

        if not wallet:
            return response("Wallet not found.", 404)

        return jsonify({"balance": float(wallet["balance"])})

    except Exception as error:
        print("Wallet error:", error)
        return response("Could not load wallet.", 500)

    finally:
        if cursor:
            cursor.close()
        if db:
            db.close()


@app.route("/api/wallet/topup", methods=["POST"])
@login_required("customer")
def topup_wallet():
    data = request.get_json() or {}

    try:
        amount = Decimal(str(data.get("amount", "0")))
    except InvalidOperation:
        return response("Invalid amount.", 400)

    if amount <= 0 or amount > Decimal("10000"):
        return response("Enter an amount between ₹1 and ₹10,000.", 400)

    db = None
    cursor = None

    try:
        db = get_db_connection()
        cursor = db.cursor()

        cursor.execute(
            "SELECT balance FROM wallets WHERE user_id = %s FOR UPDATE",
            (g.user["user_id"],)
        )

        wallet = cursor.fetchone()

        if not wallet:
            db.rollback()
            return response("Wallet not found.", 404)

        cursor.execute(
            "UPDATE wallets SET balance = balance + %s WHERE user_id = %s",
            (amount, g.user["user_id"])
        )

        reference = "TOPUP-" + str(uuid.uuid4())

        cursor.execute(
            """
            INSERT INTO wallet_transactions
            (user_id, transaction_type, amount, description, reference_id)
            VALUES (%s, 'topup', %s, 'Demo wallet top-up', %s)
            """,
            (g.user["user_id"], amount, reference)
        )

        db.commit()

        return response("Demo top-up successful.")

    except Exception as error:
        if db:
            db.rollback()
        print("Top-up error:", error)
        return response("Top-up failed.", 500)

    finally:
        if cursor:
            cursor.close()
        if db:
            db.close()


@app.route("/api/wallet/history", methods=["GET"])
@login_required()
def wallet_history():
    db = None
    cursor = None

    try:
        db = get_db_connection()
        cursor = db.cursor(dictionary=True)

        cursor.execute(
            """
            SELECT transaction_type, amount, description,
                   reference_id, created_at
            FROM wallet_transactions
            WHERE user_id = %s
            ORDER BY created_at DESC
            LIMIT 50
            """,
            (g.user["user_id"],)
        )

        records = cursor.fetchall()

        for record in records:
            record["amount"] = float(record["amount"])
            record["created_at"] = record["created_at"].isoformat()

        return jsonify({"history": records})

    except Exception as error:
        print("History error:", error)
        return response("Could not load history.", 500)

    finally:
        if cursor:
            cursor.close()
        if db:
            db.close()


# MERCHANT: CREATE A PAYMENT REQUEST

@app.route("/api/payments/request", methods=["POST"])
@login_required("merchant")
def create_payment_request():
    data = request.get_json() or {}

    try:
        amount = Decimal(str(data.get("amount", "0")))
    except InvalidOperation:
        return response("Invalid amount.", 400)

    if amount <= 0 or amount > Decimal("100000"):
        return response("Enter a valid payment amount.", 400)

    db = None
    cursor = None

    try:
        db = get_db_connection()
        cursor = db.cursor(dictionary=True)

        cursor.execute(
            "SELECT full_name FROM users WHERE user_id = %s",
            (g.user["user_id"],)
        )
        merchant = cursor.fetchone()

        if not merchant:
            return response("Merchant account not found.", 404)

        request_id = str(uuid.uuid4())
        expires_at = datetime.utcnow() + timedelta(minutes=5)

        cursor.execute(
            """
            INSERT INTO payment_requests
            (request_id, merchant_id, amount, expires_at)
            VALUES (%s, %s, %s, %s)
            """,
            (request_id, g.user["user_id"], amount, expires_at)
        )

        db.commit()

        return jsonify({
            "message": "Payment request created.",
            "payment_request": {
                "type": "qpay_payment_request",
                "request_id": request_id,
                "merchant_id": g.user["user_id"],
                "merchant_name": merchant["full_name"],
                "amount": float(amount),
                "expires_at": int(expires_at.timestamp() * 1000)
            }
        }), 201

    except Exception as error:
        if db:
            db.rollback()
        print("Payment request error:", error)
        return response("Could not create payment request.", 500)

    finally:
        if cursor:
            cursor.close()
        if db:
            db.close()


# CUSTOMER: APPROVE PAYMENT AND RECEIVE A SIGNED QR TOKEN

@app.route("/api/payments/approve", methods=["POST"])
@login_required("customer")
def approve_payment():
    data = request.get_json() or {}
    request_id = data.get("request_id")

    if not request_id:
        return response("Payment request ID is required.", 400)

    db = None
    cursor = None

    try:
        db = get_db_connection()
        cursor = db.cursor(dictionary=True)

        cursor.execute(
            """
            SELECT request_id, merchant_id, amount, status, expires_at
            FROM payment_requests
            WHERE request_id = %s
            """,
            (request_id,)
        )

        payment = cursor.fetchone()

        if not payment:
            return response("Payment request not found.", 404)

        if payment["status"] != "pending":
            return response("This payment request is no longer available.", 409)

        if payment["expires_at"] <= datetime.utcnow():
            cursor.execute(
                "UPDATE payment_requests SET status = 'expired' WHERE request_id = %s",
                (request_id,)
            )
            db.commit()
            return response("Payment request has expired.", 410)

        cursor.execute(
            "SELECT full_name FROM users WHERE user_id = %s",
            (g.user["user_id"],)
        )
        customer = cursor.fetchone()

        confirmation_id = str(uuid.uuid4())

        token_expiry = min(
            payment["expires_at"],
            datetime.utcnow() + timedelta(minutes=5)
        )

        confirmation_token = jwt.encode(
            {
                "purpose": "qpay_payment_confirmation",
                "confirmation_id": confirmation_id,
                "request_id": payment["request_id"],
                "customer_id": g.user["user_id"],
                "customer_name": customer["full_name"],
                "merchant_id": payment["merchant_id"],
                "amount": str(payment["amount"]),
                "exp": token_expiry
            },
            JWT_SECRET,
            algorithm="HS256"
        )

        return jsonify({
            "message": "Payment approved. Show this QR to the merchant.",
            "confirmation": {
                "type": "qpay_signed_confirmation",
                "token": confirmation_token
            }
        })

    except Exception as error:
        print("Payment approval error:", error)
        return response("Could not approve payment.", 500)

    finally:
        if cursor:
            cursor.close()
        if db:
            db.close()


# MERCHANT: SCAN CUSTOMER QR AND SETTLE PAYMENT

@app.route("/api/payments/settle", methods=["POST"])
@login_required("merchant")
def settle_payment():
    data = request.get_json() or {}
    confirmation_token = data.get("confirmation_token")

    if not confirmation_token:
        return response("Confirmation token is missing.", 400)

    try:
        confirmation = jwt.decode(
            confirmation_token,
            JWT_SECRET,
            algorithms=["HS256"]
        )
    except jwt.ExpiredSignatureError:
        return response("Payment confirmation has expired.", 410)
    except jwt.InvalidTokenError:
        return response("Invalid payment confirmation.", 400)

    if confirmation.get("purpose") != "qpay_payment_confirmation":
        return response("Invalid confirmation type.", 400)

    if confirmation.get("merchant_id") != g.user["user_id"]:
        return response("This payment is intended for another merchant.", 403)

    db = None
    cursor = None

    try:
        db = get_db_connection()
        cursor = db.cursor(dictionary=True)

        db.start_transaction()

        cursor.execute(
            """
            SELECT request_id, merchant_id, amount, status, expires_at
            FROM payment_requests
            WHERE request_id = %s
            FOR UPDATE
            """,
            (confirmation["request_id"],)
        )

        payment = cursor.fetchone()

        if not payment:
            db.rollback()
            return response("Payment request not found.", 404)

        if payment["status"] != "pending":
            db.rollback()
            return response("This payment has already been processed.", 409)

        if payment["expires_at"] <= datetime.utcnow():
            cursor.execute(
                "UPDATE payment_requests SET status = 'expired' WHERE request_id = %s",
                (payment["request_id"],)
            )
            db.commit()
            return response("Payment request has expired.", 410)

        if (
            payment["merchant_id"] != confirmation["merchant_id"]
            or Decimal(str(payment["amount"])) != Decimal(confirmation["amount"])
        ):
            db.rollback()
            return response("Payment details do not match.", 400)

        customer_id = int(confirmation["customer_id"])
        merchant_id = int(g.user["user_id"])
        amount = Decimal(str(payment["amount"]))
        transaction_ref = confirmation["confirmation_id"]

        if customer_id == merchant_id:
            db.rollback()
            return response("Customer and merchant cannot be the same account.", 400)

        user_ids = sorted([customer_id, merchant_id])
        placeholders = ", ".join(["%s"] * len(user_ids))

        cursor.execute(
            f"""
            SELECT user_id, balance
            FROM wallets
            WHERE user_id IN ({placeholders})
            ORDER BY user_id
            FOR UPDATE
            """,
            tuple(user_ids)
        )

        wallets = {row["user_id"]: row["balance"] for row in cursor.fetchall()}

        if customer_id not in wallets or merchant_id not in wallets:
            db.rollback()
            return response("Wallet not found.", 404)

        if Decimal(str(wallets[customer_id])) < amount:
            db.rollback()
            return response("Insufficient customer wallet balance.", 400)

        cursor.execute(
            """
            UPDATE wallets
            SET balance = balance - %s
            WHERE user_id = %s
            """,
            (amount, customer_id)
        )

        cursor.execute(
            """
            UPDATE wallets
            SET balance = balance + %s
            WHERE user_id = %s
            """,
            (amount, merchant_id)
        )

        cursor.execute(
            """
            INSERT INTO transactions
            (transaction_ref, customer_id, merchant_id, amount, status, sync_status)
            VALUES (%s, %s, %s, %s, 'confirmed', 'synced')
            """,
            (transaction_ref, customer_id, merchant_id, amount)
        )

        cursor.execute(
            """
            INSERT INTO wallet_transactions
            (user_id, transaction_type, amount, description, reference_id)
            VALUES (%s, 'payment_sent', %s, %s, %s)
            """,
            (
                customer_id,
                amount,
                "Payment sent to merchant",
                transaction_ref + "-SENT"
            )
        )

        cursor.execute(
            """
            INSERT INTO wallet_transactions
            (user_id, transaction_type, amount, description, reference_id)
            VALUES (%s, 'payment_received', %s, %s, %s)
            """,
            (
                merchant_id,
                amount,
                "Payment received from customer",
                transaction_ref + "-RECEIVED"
            )
        )

        cursor.execute(
            """
            UPDATE payment_requests
            SET status = 'paid'
            WHERE request_id = %s
            """,
            (payment["request_id"],)
        )

        db.commit()

        return jsonify({
            "message": "Payment successful!",
            "transaction": {
                "transaction_id": transaction_ref,
                "amount": float(amount),
                "customer_id": customer_id,
                "merchant_id": merchant_id,
                "status": "confirmed"
            }
        })

    except mysql.connector.IntegrityError:
        if db:
            db.rollback()
        return response("This confirmation has already been used.", 409)

    except Exception as error:
        if db:
            db.rollback()
        print("Settlement error:", error)
        return response("Payment settlement failed.", 500)

    finally:
        if cursor:
            cursor.close()
        if db:
            db.close()


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
