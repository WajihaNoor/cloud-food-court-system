import { useEffect, useState } from "react";
import { supabase } from "./supabase";
import "./App.css";

const API_URL = import.meta.env.VITE_API_URL;

async function getAuthHeaders() {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    throw new Error("No active session");
  }

  return {
    Authorization: `Bearer ${session.access_token}`,
    "Content-Type": "application/json",
  };
}

function App() {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const initializeAuth = async () => {
      const {
        data: { session },
        error,
      } = await supabase.auth.getSession();

      if (error) {
        console.error("Session error:", error);
        setLoading(false);
        return;
      }

      setSession(session);

      if (!session) {
        setLoading(false);
      }
    };

    initializeAuth();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);

      if (!session) {
        setProfile(null);
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (session?.user?.id) {
      loadProfile(session.user.id);
    }
  }, [session]);

  async function loadProfile(userId) {
    try {
      setLoading(true);

      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", userId)
        .single();

      if (error) {
        console.error("Profile loading error:", error);
        setProfile(null);
        return;
      }

      console.log("Profile loaded:", data);
      setProfile(data);
    } catch (error) {
      console.error("Profile error:", error);
      setProfile(null);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return <div className="center">Loading...</div>;
  }

  if (!session) {
    return <AuthScreen />;
  }

  if (!profile) {
    return (
      <div className="center">
        <p>Unable to load profile.</p>

        <button onClick={() => loadProfile(session.user.id)}>
          Try Again
        </button>
      </div>
    );
  }

  if (profile.role === "vendor") {
    return <VendorDashboard profile={profile} />;
  }

  return <StudentDashboard profile={profile} />;
}

/* =========================
   AUTH SCREEN
========================= */

function AuthScreen() {
  const [mode, setMode] = useState("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();

    setLoading(true);
    setMessage("");

    if (mode === "signup") {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            name,
          },
          emailRedirectTo: window.location.origin,
        },
      });

      if (error) {
        setMessage(error.message);
      } else {
        setMessage(
          "Account created. Check your email if email confirmation is enabled."
        );
      }
    } else {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        setMessage(error.message);
      }
    }

    setLoading(false);
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="logo">FoodCourt</div>

        <h1>
          {mode === "login" ? "Welcome back" : "Create account"}
        </h1>

        <p className="muted">
          University Food Court Ordering System
        </p>

        <form onSubmit={handleSubmit}>
          {mode === "signup" && (
            <input
              type="text"
              placeholder="Full name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          )}

          <input
            type="email"
            placeholder="University email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />

          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
          />

          <button type="submit" disabled={loading}>
            {loading
              ? "Please wait..."
              : mode === "login"
              ? "Sign in"
              : "Create account"}
          </button>
        </form>

        {message && <p className="message">{message}</p>}

        <button
          className="link-button"
          onClick={() => {
            setMode(mode === "login" ? "signup" : "login");
            setMessage("");
          }}
        >
          {mode === "login"
            ? "Don't have an account? Sign up"
            : "Already have an account? Sign in"}
        </button>
      </div>
    </div>
  );
}

/* =========================
   STUDENT DASHBOARD
========================= */

function StudentDashboard({ profile }) {
  const [menu, setMenu] = useState([]);
  const [cart, setCart] = useState([]);
  const [orders, setOrders] = useState([]);
  const [message, setMessage] = useState("");

  useEffect(() => {
    loadMenu();
    loadOrders();
  }, []);

  async function loadMenu() {
    try {
      const headers = await getAuthHeaders();

      const response = await fetch(`${API_URL}/api/menu`, {
        method: "GET",
        headers,
      });

      const data = await response.json();

      if (!response.ok) {
        setMessage(data.error || "Could not load menu.");
        return;
      }

      if (Array.isArray(data)) {
        setMenu(data);
      }
    } catch (error) {
      console.error("Menu loading error:", error);
      setMessage("Could not load menu.");
    }
  }

  async function loadOrders() {
    try {
      const headers = await getAuthHeaders();

      const response = await fetch(`${API_URL}/api/orders/mine`, {
        method: "GET",
        headers,
      });

      const data = await response.json();

      if (!response.ok) {
        setMessage(data.error || "Could not load your orders.");
        return;
      }

      if (Array.isArray(data)) {
        setOrders(data);
      }
    } catch (error) {
      console.error("Orders loading error:", error);
      setMessage("Could not load your orders.");
    }
  }

  function addToCart(item) {
    setCart((current) => {
      const existing = current.find(
        (cartItem) => cartItem.id === item.id
      );

      if (existing) {
        return current.map((cartItem) =>
          cartItem.id === item.id
            ? {
                ...cartItem,
                quantity: cartItem.quantity + 1,
              }
            : cartItem
        );
      }

      return [
        ...current,
        {
          ...item,
          quantity: 1,
        },
      ];
    });
  }

  function removeFromCart(id) {
    setCart((current) =>
      current.filter((item) => item.id !== id)
    );
  }

  async function placeOrder() {
    if (cart.length === 0) {
      setMessage("Your cart is empty.");
      return;
    }

    try {
      const headers = await getAuthHeaders();

      const response = await fetch(`${API_URL}/api/orders`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          items: cart.map((item) => ({
            menu_item_id: item.id,
            quantity: item.quantity,
          })),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setMessage(data.error || "Order failed.");
        return;
      }

      setMessage("Order placed successfully!");
      setCart([]);

      await loadOrders();
    } catch (error) {
      console.error("Order error:", error);
      setMessage("Could not place order.");
    }
  }

  async function logout() {
    await supabase.auth.signOut();
  }

  const total = cart.reduce(
    (sum, item) =>
      sum + Number(item.price) * item.quantity,
    0
  );

  return (
    <div className="dashboard">
      <header>
        <div>
          <div className="logo">FoodCourt</div>
          <p>Hi, {profile.name}</p>
        </div>

        <button className="secondary" onClick={logout}>
          Sign out
        </button>
      </header>

      <main>
        <section>
          <h1>Today's Menu</h1>

          <p className="muted">
            Choose your food and place your order.
          </p>

          <div className="menu-grid">
            {menu.map((item) => (
              <div className="food-card" key={item.id}>
                <div className="food-icon">🍽️</div>

                <h3>{item.name}</h3>

                <p>{item.description}</p>

                <div className="food-bottom">
                  <strong>Rs. {item.price}</strong>

                  <button onClick={() => addToCart(item)}>
                    Add
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>

        <aside className="cart">
          <h2>Your Order</h2>

          {cart.length === 0 ? (
            <p className="muted">
              Your cart is empty.
            </p>
          ) : (
            <>
              {cart.map((item) => (
                <div className="cart-item" key={item.id}>
                  <div>
                    <strong>{item.name}</strong>

                    <span>
                      {item.quantity} × Rs. {item.price}
                    </span>
                  </div>

                  <button
                    className="remove"
                    onClick={() =>
                      removeFromCart(item.id)
                    }
                  >
                    ×
                  </button>
                </div>
              ))}

              <div className="cart-total">
                <span>Total</span>

                <strong>Rs. {total}</strong>
              </div>

              <button
                className="checkout"
                onClick={placeOrder}
              >
                Pay Token & Place Order
              </button>
            </>
          )}

          {message && (
            <p className="message">
              {message}
            </p>
          )}
        </aside>

        <section className="orders-section">
          <h2>My Orders</h2>

          {orders.length === 0 ? (
            <p className="muted">
              No orders yet.
            </p>
          ) : (
            orders.map((order) => (
              <div
                className="order-card"
                key={order.id}
              >
                <div>
                  <strong>
                    Order #{order.id}
                  </strong>

                  <p>
                    Total: Rs. {order.total_amount}
                  </p>
                </div>

                <span
                  className={`status ${order.status}`}
                >
                  {order.status}
                </span>
              </div>
            ))
          )}
        </section>
      </main>
    </div>
  );
}

/* =========================
   VENDOR DASHBOARD
========================= */

function VendorDashboard({ profile }) {
  const [orders, setOrders] = useState([]);
  const [message, setMessage] = useState("");

useEffect(() => {
  loadOrders();

  const channel = supabase
    .channel("vendor-orders")
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "orders",
      },
      () => {
        console.log("New order update received");
        loadOrders();
      }
    )
    .subscribe((status) => {
      console.log("Realtime status:", status);
    });

  return () => {
    supabase.removeChannel(channel);
  };
}, []);

  async function loadOrders() {
    try {
      const headers = await getAuthHeaders();

      const response = await fetch(
        `${API_URL}/api/orders/queue`,
        {
          method: "GET",
          headers,
        }
      );

      const data = await response.json();

      console.log("Vendor orders response:", {
        status: response.status,
        data,
      });

      if (!response.ok) {
        setMessage(
          data.error ||
            `Failed to load orders (${response.status})`
        );

        setOrders([]);
        return;
      }

      if (Array.isArray(data)) {
        setOrders(data);
      } else {
        console.error(
          "Unexpected vendor response:",
          data
        );

        setMessage(
          "Unexpected response from server."
        );

        setOrders([]);
      }
    } catch (error) {
      console.error(
        "Vendor orders loading error:",
        error
      );

      setMessage(
        "Could not connect to the server."
      );
    }
  }

  async function updateStatus(orderId, status) {
    try {
      const headers = await getAuthHeaders();

      const response = await fetch(
        `${API_URL}/api/orders/${orderId}/status`,
        {
          method: "PATCH",
          headers,
          body: JSON.stringify({
            status,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        setMessage(
          data.error ||
            "Could not update order."
        );
        return;
      }

      setMessage(
        `Order #${orderId} updated to ${status}.`
      );

      await loadOrders();
    } catch (error) {
      console.error(
        "Status update error:",
        error
      );

      setMessage(
        "Could not update order status."
      );
    }
  }

  async function logout() {
    await supabase.auth.signOut();
  }

  return (
    <div className="dashboard">
      <header>
        <div>
          <div className="logo">
            FoodCourt Vendor
          </div>

          <p>{profile.name}</p>
        </div>

        <button
          className="secondary"
          onClick={logout}
        >
          Sign out
        </button>
      </header>

      <main>
        <section className="vendor-section">
          <h1>Incoming Orders</h1>

          <p className="muted">
            Orders appear automatically when students place them.
          </p>

          {message && (
            <p className="message">
              {message}
            </p>
          )}

          {orders.length === 0 ? (
            <div className="empty">
              No incoming orders.
            </div>
          ) : (
            <div className="vendor-orders">
              {orders.map((order) => (
                <div
                  className="vendor-order"
                  key={order.id}
                >
                  <div className="order-header">
                    <strong>
                      Order #{order.id}
                    </strong>

                    <span
                      className={`status ${order.status}`}
                    >
                      {order.status}
                    </span>
                  </div>

                  {order.order_items?.map(
                    (item) => (
                      <div
                        className="vendor-item"
                        key={item.id}
                      >
                        <span>
                          {item.item_name} ×{" "}
                          {item.quantity}
                        </span>

                        <span>
                          Rs.{" "}
                          {Number(
                            item.price_snapshot
                          ) *
                            item.quantity}
                        </span>
                      </div>
                    )
                  )}

                  <div className="vendor-total">
                    Total: Rs.{" "}
                    {order.total_amount}
                  </div>

                  <div className="status-buttons">
                    {order.status ===
                      "received" && (
                      <button
                        onClick={() =>
                          updateStatus(
                            order.id,
                            "preparing"
                          )
                        }
                      >
                        Start Preparing
                      </button>
                    )}

                    {order.status ===
                      "preparing" && (
                      <button
                        onClick={() =>
                          updateStatus(
                            order.id,
                            "ready"
                          )
                        }
                      >
                        Mark Ready
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

export default App;