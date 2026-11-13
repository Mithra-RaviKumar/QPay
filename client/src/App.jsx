
import { useState, useEffect } from "react";
import { Routes, Route, Link, useNavigate } from "react-router-dom";
import axios from "axios";
import QRCode from "qrcode";
import { Html5QrcodeScanner } from "html5-qrcode";
import "./App.css";

const API_URL = "http://127.0.0.1:5000/api";

function getToken() {
  return localStorage.getItem("qpay_token");
}

function authHeaders() {
  return { Authorization: `Bearer ${getToken()}` };
}

function getError(error, fallback) {
  return error.response?.data?.message ||
    error.response?.data?.error ||
    fallback;
}

function getUser() {
  try {
    return JSON.parse(localStorage.getItem("qpay_user") || "{}");
  } catch {
    return {};
  }
}

function Welcome() {
  return (
    <div className="welcome">
      <h1>Q<span>Pay</span></h1>
      <p>Scan. Verify. Record. Reconcile.</p>
      <h2>Payments made simpler.</h2>
      <Link to="/register" className="primary-btn">Create Account</Link>
      <Link to="/login" className="secondary-btn">Login</Link>
    </div>
  );
}

function Register() {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    confirmPassword: "",
    role: "customer"
  });
  const [message, setMessage] = useState("");

  function update(e) {
    setForm({ ...form, [e.target.name]: e.target.value });
  }

  async function handleRegister(e) {
    e.preventDefault();
    setMessage("");

    if (form.password !== form.confirmPassword) {
      setMessage("Passwords do not match.");
      return;
    }

    try {
      await axios.post(`${API_URL}/register`, {
        full_name: form.name,
        email: form.email,
        password: form.password,
        role: form.role
      });

      alert("Registration successful!");
      navigate("/login");
    } catch (error) {
      setMessage(getError(error, "Registration failed."));
    }
  }

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={handleRegister}>
        <h1>Create Account</h1>

        <input
          name="name"
          placeholder="Full Name"
          value={form.name}
          onChange={update}
          required
        />

        <input
          name="email"
          type="email"
          placeholder="Email"
          value={form.email}
          onChange={update}
          required
        />

        <input
          name="password"
          type="password"
          placeholder="Password"
          value={form.password}
          onChange={update}
          required
        />

        <input
          name="confirmPassword"
          type="password"
          placeholder="Confirm Password"
          value={form.confirmPassword}
          onChange={update}
          required
        />

        <label>Account Type</label>
        <select name="role" value={form.role} onChange={update}>
          <option value="customer">Customer</option>
          <option value="merchant">Merchant</option>
        </select>

        {message && <p className="error">{message}</p>}

        <button type="submit">Register</button>
        <p>Already registered? <Link to="/login">Login</Link></p>
      </form>
    </div>
  );
}

function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");

  async function handleLogin(e) {
    e.preventDefault();
    setMessage("");

    try {
      const response = await axios.post(`${API_URL}/login`, {
        email,
        password
      });

      localStorage.setItem("qpay_token", response.data.token);
      localStorage.setItem("qpay_user", JSON.stringify(response.data.user));

      navigate(`/${response.data.user.role}`);
    } catch (error) {
      setMessage(getError(error, "Login failed."));
    }
  }

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={handleLogin}>
        <h1>Welcome Back</h1>

        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          required
        />

        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          required
        />

        {message && <p className="error">{message}</p>}

        <button type="submit">Login</button>
        <p>New to QPay? <Link to="/register">Create Account</Link></p>
      </form>
    </div>
  );
}

function Dashboard({ role }) {
  const navigate = useNavigate();
  const user = getUser();

  const [balance, setBalance] = useState("0.00");
  const [amount, setAmount] = useState("");
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [message, setMessage] = useState("");
  const [transactions, setTransactions] = useState([]);

  async function loadWallet() {
    try {
      const response = await axios.get(`${API_URL}/wallet`, {
        headers: authHeaders()
      });

      setBalance(response.data.balance ?? "0.00");
    } catch (error) {
      alert(getError(error, "Unable to load wallet. Please login again."));
      navigate("/login");
    } finally {
      setLoading(false);
    }
  }

  async function loadHistory() {
    try {
      const response = await axios.get(`${API_URL}/wallet/history`, {
        headers: authHeaders()
      });

      const history = response.data?.history ?? response.data?.transactions;

      setTransactions(Array.isArray(history) ? history : []);
    } catch (error) {
      console.error("Wallet history loading failed:", error);
      setTransactions([]);
    }
  }

  useEffect(() => {
    if (!getToken()) {
      navigate("/login");
      return;
    }

    loadWallet();
    loadHistory();
  }, []);

  async function handleTopup(e) {
    e.preventDefault();
    setMessage("");

    try {
      setAdding(true);

      await axios.post(
        `${API_URL}/wallet/topup`,
        { amount: Number(amount) },
        { headers: authHeaders() }
      );

      setAmount("");
      setMessage("Demo money added successfully!");

      await loadWallet();
      await loadHistory();
    } catch (error) {
      setMessage(getError(error, "Top-up failed."));
    } finally {
      setAdding(false);
    }
  }

  function logout() {
    localStorage.removeItem("qpay_token");
    localStorage.removeItem("qpay_user");
    sessionStorage.clear();
    navigate("/login");
  }

  return (
    <div className="dashboard">
      <nav className="navbar">
        <h2>Q<span>Pay</span></h2>
        <button onClick={logout} className="logout-btn">Logout</button>
      </nav>

      <main className="dashboard-content">
        <p className="tagline">{role.toUpperCase()} DASHBOARD</p>
        <h1>Hello, {user.full_name || user.name || "User"}!</h1>
        <p>Welcome to your QPay account.</p>

        <div className="wallet-card">
          <p>AVAILABLE WALLET BALANCE</p>
          <h2>{loading ? "Loading..." : `₹ ${balance}`}</h2>
          <span>QPay Demo Wallet</span>
        </div>

        {role === "customer" && (
          <>
            <div className="dashboard-card topup-card">
              <h2>Add Money</h2>

              <form onSubmit={handleTopup}>
                <input
                  type="number"
                  min="1"
                  max="10000"
                  step="0.01"
                  placeholder="Enter amount"
                  value={amount}
                  onChange={e => setAmount(e.target.value)}
                  required
                />

                <button disabled={adding}>
                  {adding ? "Adding..." : "Add Money"}
                </button>
              </form>

              {message && <p className="topup-message">{message}</p>}
              <small>Demo funds only.</small>
            </div>

            <Link className="action-link" to="/customer/scan">
              Scan Merchant QR
            </Link>
          </>
        )}

        {role === "merchant" && (
          <Link className="action-link" to="/merchant/request">
            Generate Payment QR
          </Link>
        )}

        <div className="dashboard-card">
          <h2>Account Details</h2>
          <p>Name: {user.full_name || user.name}</p>
          <p>Email: {user.email}</p>
          <p>Account Type: {role}</p>
        </div>

        <div className="dashboard-card history-card">
          <h2>Wallet History</h2>

          {transactions.length === 0 ? (
            <p>No transactions yet.</p>
          ) : (
            transactions.map((t, index) => (
              <div
                className="history-item"
                key={t.id || t.reference_id || index}
              >
                <div>
                  <strong>
                    {t.transaction_type === "topup"
                      ? "Money Added"
                      : t.transaction_type === "payment_sent"
                        ? "Payment Sent"
                        : t.transaction_type === "payment_received"
                          ? "Payment Received"
                          : t.transaction_type}
                  </strong>
                  <p>{t.description}</p>
                  <small>
                    {t.created_at
                      ? new Date(t.created_at).toLocaleString()
                      : ""}
                  </small>
                </div>

                <strong className="history-amount">₹{t.amount}</strong>
              </div>
            ))
          )}
        </div>
      </main>
    </div>
  );
}

// MERCHANT: Create a payment request through Flask and display its QR.
function MerchantRequest() {
  const navigate = useNavigate();
  const user = getUser();

  const [amount, setAmount] = useState("");
  const [qr, setQr] = useState("");
  const [request, setRequest] = useState(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function generateQR(e) {
    e.preventDefault();
    setMessage("");
    setQr("");
    setRequest(null);

    const value = Number(amount);

    if (!Number.isFinite(value) || value <= 0 || value > 10000) {
      setMessage("Enter an amount between ₹1 and ₹10,000.");
      return;
    }

    try {
      setLoading(true);

      const response = await axios.post(
        `${API_URL}/payments/request`,
        { amount: value },
        { headers: authHeaders() }
      );

      const paymentRequest =
        response.data.payment_request || response.data;

      if (!paymentRequest.request_id) {
        throw new Error("The server did not return a payment request ID.");
      }

      const image = await QRCode.toDataURL(
        JSON.stringify(paymentRequest),
        { width: 300, margin: 2 }
      );

      setRequest(paymentRequest);
      setQr(image);

      // Keep the request ID for display only.
      sessionStorage.setItem(
        "qpay_active_request",
        JSON.stringify(paymentRequest)
      );
    } catch (error) {
      setMessage(
        error.response
          ? getError(error, "Unable to create payment request.")
          : error.message || "Unable to generate QR code."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="feature-page">
      <button
        className="back-btn"
        onClick={() => navigate("/merchant")}
      >
        ← Dashboard
      </button>

      <div className="feature-card">
        <h1>Request Payment</h1>
        <p>Enter the amount to generate your payment QR.</p>

        <form onSubmit={generateQR}>
          <input
            type="number"
            min="1"
            max="10000"
            step="0.01"
            placeholder="Amount in ₹"
            value={amount}
            onChange={e => setAmount(e.target.value)}
            required
          />

          <button type="submit" disabled={loading}>
            {loading ? "Generating..." : "Generate QR Code"}
          </button>
        </form>

        {message && <p className="error">{message}</p>}

        {qr && request && (
          <div className="qr-result">
            <img src={qr} alt="Merchant payment request QR" />
            <h2>₹{Number(request.amount).toFixed(2)}</h2>
            <p>{user.full_name || user.name}</p>
            <p>Request ID: {request.request_id.slice(0, 12)}</p>
            <p>Ask the customer to scan this QR.</p>
            <small>Payment request expires in 5 minutes.</small>

            <button onClick={() => navigate("/merchant/verify")}>
              Scan Customer Confirmation
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// CUSTOMER: Scan the merchant's server-generated payment request.
function CustomerScan() {
  const navigate = useNavigate();
  const [request, setRequest] = useState(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const scanner = new Html5QrcodeScanner(
      "customer-qr-reader",
      {
        fps: 10,
        qrbox: { width: 230, height: 230 }
      },
      false
    );

    let scanned = false;

    scanner.render(
      decodedText => {
        if (scanned) return;

        try {
          const data = JSON.parse(decodedText);

          if (
            data.type !== "qpay_payment_request" ||
            !data.request_id ||
            !data.merchant_id ||
            !Number.isFinite(Number(data.amount)) ||
            Number(data.amount) <= 0
          ) {
            setMessage("Invalid payment QR.");
            return;
          }

          if (data.expires_at && Number(data.expires_at) < Date.now()) {
            setMessage("This payment request has expired.");
            return;
          }

          scanned = true;
          scanner.clear().catch(() => {});

          setRequest(data);
          sessionStorage.setItem(
            "qpay_scanned_request",
            JSON.stringify(data)
          );
        } catch {
          setMessage("Invalid QR code.");
        }
      },
      () => {}
    );

    return () => {
      scanner.clear().catch(() => {});
    };
  }, []);

  function approvePayment() {
    if (!request) return;
    navigate("/customer/confirm");
  }

  return (
    <div className="feature-page">
      <button
        className="back-btn"
        onClick={() => navigate("/customer")}
      >
        ← Dashboard
      </button>

      <div className="feature-card">
        <h1>Scan Merchant QR</h1>

        {!request && <div id="customer-qr-reader"></div>}

        {message && <p className="error">{message}</p>}

        {request && (
          <div className="payment-review">
            <h2>Payment Details</h2>
            <p>Merchant: {request.merchant_name}</p>
            <h1>₹{request.amount}</h1>
            <p>Request ID: {request.request_id.slice(0, 12)}</p>
            <button onClick={approvePayment}>
              Approve & Continue
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// CUSTOMER: Approve through Flask and display the signed confirmation token QR.
function CustomerConfirm() {
  const navigate = useNavigate();
  const user = getUser();

  const [qr, setQr] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function createConfirmation() {
      try {
        const request = JSON.parse(
          sessionStorage.getItem("qpay_scanned_request") || "null"
        );

        if (!request || !request.request_id) {
          setMessage("No payment request found. Please scan again.");
          return;
        }

        if (
          request.expires_at &&
          Number(request.expires_at) < Date.now()
        ) {
          setMessage("Payment request expired. Please scan again.");
          return;
        }

        const response = await axios.post(
          `${API_URL}/payments/approve`,
          { request_id: request.request_id },
          { headers: authHeaders() }
        );

        const confirmation = response.data.confirmation;

        if (
          !confirmation ||
          confirmation.type !== "qpay_signed_confirmation" ||
          !confirmation.token
        ) {
          throw new Error("The server did not return a signed confirmation.");
        }

        const image = await QRCode.toDataURL(
          JSON.stringify(confirmation),
          { width: 300, margin: 2 }
        );

        if (cancelled) return;

        setQr(image);

        sessionStorage.setItem(
          "qpay_confirmation",
          JSON.stringify(confirmation)
        );
      } catch (error) {
        if (!cancelled) {
          setMessage(getError(error, error.message || "Unable to approve payment."));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    createConfirmation();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="feature-page">
      <div className="feature-card">
        <h1>Payment Confirmation</h1>

        <p>
          Show this confirmation QR to the merchant to complete payment.
        </p>

        {loading && <p>Processing your approval...</p>}

        {qr && (
          <img
            className="confirmation-qr"
            src={qr}
            alt="Signed customer payment confirmation QR"
          />
        )}

        {message && <p className="error">{message}</p>}

        {qr && (
          <p className="success-text">
            Payment approved. Waiting for merchant verification.
          </p>
        )}

        <p className="warning-text">
          This is a demo wallet transaction. No real bank or UPI money is transferred.
        </p>

        <button onClick={() => navigate("/customer")}>
          Back to Dashboard
        </button>
      </div>
    </div>
  );
}

// MERCHANT: Scan signed confirmation and ask Flask to verify and settle it.
function MerchantVerify() {
  const navigate = useNavigate();

  const [result, setResult] = useState(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let scanned = false;

    const scanner = new Html5QrcodeScanner(
      "merchant-qr-reader",
      {
        fps: 10,
        qrbox: { width: 230, height: 230 }
      },
      false
    );

    scanner.render(
      async decodedText => {
        if (scanned || loading) return;

        let confirmation;

        try {
          confirmation = JSON.parse(decodedText);
        } catch {
          setMessage("Invalid confirmation QR.");
          return;
        }

        if (
          confirmation.type !== "qpay_signed_confirmation" ||
          !confirmation.token
        ) {
          setMessage("This is not a valid QPay signed confirmation QR.");
          return;
        }

        scanned = true;
        scanner.clear().catch(() => {});
        setLoading(true);
        setMessage("Verifying payment with server...");

        try {
          const response = await axios.post(
            `${API_URL}/payments/settle`,
            { confirmation_token: confirmation.token },
            { headers: authHeaders() }
          );

          setResult(response.data);
          setMessage(
            response.data.message || "Payment successfully verified and settled!"
          );
        } catch (error) {
          scanned = false;
          setMessage(getError(error, "Payment verification failed."));
        } finally {
          setLoading(false);
        }
      },
      () => {}
    );

    return () => {
      scanner.clear().catch(() => {});
    };
  }, []);

  return (
    <div className="feature-page">
      <button
        className="back-btn"
        onClick={() => navigate("/merchant")}
      >
        ← Dashboard
      </button>

      <div className="feature-card">
        <h1>Verify Customer Payment</h1>

        {!result && !loading && (
          <>
            <p>Scan the customer's signed confirmation QR.</p>
            <div id="merchant-qr-reader"></div>
          </>
        )}

        {loading && <p>{message}</p>}

        {message && (
          <p className={result ? "success-text" : "error"}>
            {message}
          </p>
        )}

        {result && (
          <div className="payment-review">
            <h2>Payment Successful!</h2>
            <p>Server verification completed.</p>

            {result.transaction_ref && (
              <p>Transaction: {result.transaction_ref}</p>
            )}

            <p className="success-text">
              Customer wallet debited and merchant wallet credited.
            </p>

            <button onClick={() => navigate("/merchant")}>
              Back to Dashboard
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function App() {
  return (
    <Routes>
      <Route path="/" element={<Welcome />} />
      <Route path="/register" element={<Register />} />
      <Route path="/login" element={<Login />} />

      <Route path="/customer" element={<Dashboard role="customer" />} />
      <Route path="/merchant" element={<Dashboard role="merchant" />} />

      <Route path="/merchant/request" element={<MerchantRequest />} />
      <Route path="/merchant/verify" element={<MerchantVerify />} />

      <Route path="/customer/scan" element={<CustomerScan />} />
      <Route path="/customer/confirm" element={<CustomerConfirm />} />
    </Routes>
  );
}

export default App;
