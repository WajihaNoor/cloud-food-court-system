const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const { createClient } = require("@supabase/supabase-js");

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(
  cors({
    origin: process.env.FRONTEND_URL || "http://localhost:5173",
  })
);

app.use(express.json());

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);


// =========================
// AUTHENTICATION
// =========================

async function authenticate(req, res, next) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        error: "Authentication required",
      });
    }

    const token = authHeader.substring(7);

    const {
      data: { user },
      error: userError,
    } = await supabaseAdmin.auth.getUser(token);

    if (userError || !user) {
      return res.status(401).json({
        error: "Invalid or expired token",
      });
    }

    const { data: profile, error: profileError } =
      await supabaseAdmin
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .single();

    if (profileError || !profile) {
      return res.status(403).json({
        error: "User profile not found",
      });
    }

    req.user = user;
    req.profile = profile;

    next();
  } catch (error) {
    console.error("Authentication error:", error);

    res.status(401).json({
      error: "Authentication failed",
    });
  }
}


// =========================
// ROLE AUTHORIZATION
// =========================

function requireRole(role) {
  return (req, res, next) => {
    if (req.profile.role !== role) {
      return res.status(403).json({
        error: "Access denied",
      });
    }

    next();
  };
}


// =========================
// HEALTH CHECK
// =========================

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    message: "Food Court API is running",
  });
});


// =========================
// MENU
// =========================

app.get(
  "/api/menu",
  authenticate,
  async (req, res) => {
    try {
      const { data, error } = await supabaseAdmin
        .from("menu_items")
        .select("*")
        .eq("available", true)
        .order("created_at", {
          ascending: false,
        });

      if (error) {
        return res.status(500).json({
          error: error.message,
        });
      }

      res.json(data);
    } catch (error) {
      res.status(500).json({
        error: "Server error",
      });
    }
  }
);


// =========================
// CREATE ORDER
// =========================

app.post(
  "/api/orders",
  authenticate,
  requireRole("student"),
  async (req, res) => {
    try {
      const { items } = req.body;

      if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({
          error: "Order items are required",
        });
      }

      const menuIds = items.map(
        (item) => item.menu_item_id
      );

      const uniqueMenuIds = [
        ...new Set(menuIds),
      ];

      if (uniqueMenuIds.length !== menuIds.length) {
        return res.status(400).json({
          error: "Duplicate menu items are not allowed",
        });
      }

      const { data: menuItems, error: menuError } =
        await supabaseAdmin
          .from("menu_items")
          .select("*")
          .in("id", uniqueMenuIds)
          .eq("available", true);

      if (menuError) {
        return res.status(500).json({
          error: menuError.message,
        });
      }

      if (
        !menuItems ||
        menuItems.length !== uniqueMenuIds.length
      ) {
        return res.status(400).json({
          error: "One or more menu items are unavailable",
        });
      }

      let total = 0;

      const orderItems = items.map((item) => {
        const menuItem = menuItems.find(
          (menu) =>
            menu.id === item.menu_item_id
        );

        const quantity = Number(item.quantity);

        if (
          !Number.isInteger(quantity) ||
          quantity < 1 ||
          quantity > 20
        ) {
          throw new Error(
            "Quantity must be between 1 and 20"
          );
        }

        total +=
          Number(menuItem.price) * quantity;

        return {
          menu_item_id: menuItem.id,
          item_name: menuItem.name,
          price_snapshot: menuItem.price,
          quantity,
        };
      });

      const { data: order, error: orderError } =
        await supabaseAdmin
          .from("orders")
          .insert({
            student_id: req.user.id,
            total_amount: total,
            status: "received",
            payment_status: "paid",
          })
          .select()
          .single();

      if (orderError) {
        return res.status(500).json({
          error: orderError.message,
        });
      }

      const itemsWithOrderId =
        orderItems.map((item) => ({
          ...item,
          order_id: order.id,
        }));

      const { error: itemsError } =
        await supabaseAdmin
          .from("order_items")
          .insert(itemsWithOrderId);

      if (itemsError) {
        await supabaseAdmin
          .from("orders")
          .delete()
          .eq("id", order.id);

        return res.status(500).json({
          error: itemsError.message,
        });
      }

      res.status(201).json({
        message: "Order created successfully",
        order,
        items: itemsWithOrderId,
      });
    } catch (error) {
      res.status(400).json({
        error:
          error.message || "Order creation failed",
      });
    }
  }
);


// =========================
// STUDENT ORDERS
// =========================

app.get(
  "/api/orders/mine",
  authenticate,
  requireRole("student"),
  async (req, res) => {
    try {
      const { data, error } =
        await supabaseAdmin
          .from("orders")
          .select(`
            *,
            order_items (*)
          `)
          .eq("student_id", req.user.id)
          .order("created_at", {
            ascending: false,
          });

      if (error) {
        return res.status(500).json({
          error: error.message,
        });
      }

      res.json(data);
    } catch (error) {
      res.status(500).json({
        error: "Server error",
      });
    }
  }
);


// =========================
// VENDOR ORDER QUEUE
// =========================

app.get(
  "/api/orders/queue",
  authenticate,
  requireRole("vendor"),
  async (req, res) => {
    try {
      const { data, error } =
        await supabaseAdmin
          .from("orders")
          .select(`
            *,
            order_items (*)
          `)
          .in("status", [
            "received",
            "preparing",
            "ready",
          ])
          .order("created_at", {
            ascending: true,
          });

      if (error) {
        return res.status(500).json({
          error: error.message,
        });
      }

      res.json(data);
    } catch (error) {
      res.status(500).json({
        error: "Server error",
      });
    }
  }
);


// =========================
// UPDATE ORDER STATUS
// =========================

app.patch(
  "/api/orders/:id/status",
  authenticate,
  requireRole("vendor"),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { status } = req.body;

      const allowedTransitions = {
        received: "preparing",
        preparing: "ready",
      };

      const { data: currentOrder, error: findError } =
        await supabaseAdmin
          .from("orders")
          .select("status")
          .eq("id", id)
          .single();

      if (findError || !currentOrder) {
        return res.status(404).json({
          error: "Order not found",
        });
      }

      if (
        allowedTransitions[
          currentOrder.status
        ] !== status
      ) {
        return res.status(400).json({
          error: `Invalid status transition from ${currentOrder.status} to ${status}`,
        });
      }

      const { data, error } =
        await supabaseAdmin
          .from("orders")
          .update({
            status,
            updated_at:
              new Date().toISOString(),
          })
          .eq("id", id)
          .select()
          .single();

      if (error) {
        return res.status(500).json({
          error: error.message,
        });
      }

      res.json(data);
    } catch (error) {
      res.status(500).json({
        error: "Server error",
      });
    }
  }
);


app.listen(PORT, "0.0.0.0", () => {
  console.log(
    `Food Court API running on port ${PORT}`
  );
});