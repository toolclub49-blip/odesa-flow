"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, deleteDoc, doc, getDocs, onSnapshot, orderBy, query, setDoc, writeBatch } from "firebase/firestore";
import { getDb, isFirebaseConfigured } from "@/lib/firebase";
import type { AppSnapshot, ClientRecord, OrderRecord } from "@/types";
import { createId } from "@/lib/utils";

const LOCAL_ORDERS_KEY = "odessa_orders_v1";
const LOCAL_CLIENTS_KEY = "odessa_clients_v1";

function readLocal(): AppSnapshot {
  if (typeof window === "undefined") return { orders: [], clients: [] };
  return {
    orders: JSON.parse(localStorage.getItem(LOCAL_ORDERS_KEY) || "[]"),
    clients: JSON.parse(localStorage.getItem(LOCAL_CLIENTS_KEY) || "[]")
  };
}

function writeLocal(snapshot: AppSnapshot) {
  if (typeof window === "undefined") return;
  localStorage.setItem(LOCAL_ORDERS_KEY, JSON.stringify(snapshot.orders));
  localStorage.setItem(LOCAL_CLIENTS_KEY, JSON.stringify(snapshot.clients));
}

export function useCRMData() {
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [clients, setClients] = useState<ClientRecord[]>([]);
  const [ready, setReady] = useState(false);
  const cloudEnabled = useMemo(() => isFirebaseConfigured(), []);

  useEffect(() => {
    if (!cloudEnabled) {
      const snapshot = readLocal();
      setOrders(snapshot.orders);
      setClients(snapshot.clients);
      setReady(true);
      return;
    }

    const db = getDb();
    if (!db) {
      const snapshot = readLocal();
      setOrders(snapshot.orders);
      setClients(snapshot.clients);
      setReady(true);
      return;
    }

    const ordersQuery = query(collection(db, "orders"), orderBy("createdAt", "desc"));
    const clientsQuery = query(collection(db, "clients"), orderBy("name", "asc"));

    const unsubOrders = onSnapshot(ordersQuery, (snapshot) => {
      setOrders(snapshot.docs.map((item) => ({ id: item.id, ...(item.data() as Omit<OrderRecord, "id">) })));
      setReady(true);
    });

    const unsubClients = onSnapshot(clientsQuery, (snapshot) => {
      setClients(snapshot.docs.map((item) => ({ id: item.id, ...(item.data() as Omit<ClientRecord, "id">) })));
      setReady(true);
    });

    return () => {
      unsubOrders();
      unsubClients();
    };
  }, [cloudEnabled]);

  useEffect(() => {
    if (!cloudEnabled && ready) {
      writeLocal({ orders, clients });
    }
  }, [orders, clients, cloudEnabled, ready]);

  async function addOrders(newOrders: OrderRecord[]) {
    if (!cloudEnabled) {
      setOrders((prev) => [...newOrders, ...prev]);
      setClients((prev) => {
        const next = [...prev];
        newOrders.forEach((order) => {
          const existing = next.find((client) => client.phone === order.phone);
          if (!existing) {
            next.push({
              id: createId(),
              name: order.name,
              phone: order.phone,
              addr: order.addr,
              createdAt: Date.now(),
              updatedAt: Date.now()
            });
          } else {
            existing.name = order.name || existing.name;
            existing.addr = order.addr || existing.addr;
            existing.updatedAt = Date.now();
          }
        });
        return next;
      });
      return;
    }

    const db = getDb();
    if (!db) return;
    const batch = writeBatch(db);
    const existingClients = new Map(clients.map((client) => [client.phone, client]));

    newOrders.forEach((order) => {
      const orderRef = doc(collection(db, "orders"));
      batch.set(orderRef, order);

      const existingClient = existingClients.get(order.phone);
      if (existingClient) {
        batch.set(
          doc(db, "clients", existingClient.id),
          {
            ...existingClient,
            name: order.name || existingClient.name,
            addr: order.addr || existingClient.addr,
            updatedAt: Date.now()
          },
          { merge: true }
        );
      } else {
        batch.set(doc(collection(db, "clients")), {
          name: order.name,
          phone: order.phone,
          addr: order.addr,
          createdAt: Date.now(),
          updatedAt: Date.now()
        });
      }
    });

    await batch.commit();
  }

  async function saveOrder(order: OrderRecord) {
    if (!cloudEnabled) {
      setOrders((prev) => prev.map((item) => (item.id === order.id ? order : item)));
      return;
    }
    const db = getDb();
    if (!db) return;
    await setDoc(doc(db, "orders", order.id), order, { merge: true });
  }

  async function removeOrder(orderId: string) {
    if (!cloudEnabled) {
      setOrders((prev) => prev.filter((item) => item.id !== orderId));
      return;
    }
    const db = getDb();
    if (!db) return;
    await deleteDoc(doc(db, "orders", orderId));
  }

  async function saveClient(client: ClientRecord) {
    if (!cloudEnabled) {
      setClients((prev) => prev.map((item) => (item.id === client.id ? client : item)));
      return;
    }
    const db = getDb();
    if (!db) return;
    await setDoc(doc(db, "clients", client.id), client, { merge: true });
  }

  async function removeClient(clientId: string) {
    if (!cloudEnabled) {
      setClients((prev) => prev.filter((item) => item.id !== clientId));
      return;
    }
    const db = getDb();
    if (!db) return;
    await deleteDoc(doc(db, "clients", clientId));
  }

  async function importSnapshot(snapshot: AppSnapshot) {
    if (!cloudEnabled) {
      setOrders(snapshot.orders);
      setClients(snapshot.clients);
      return;
    }

    const db = getDb();
    if (!db) return;
    const batch = writeBatch(db);

    const existingOrders = await getDocs(collection(db, "orders"));
    existingOrders.docs.forEach((entry) => batch.delete(doc(db, "orders", entry.id)));
    const existingClients = await getDocs(collection(db, "clients"));
    existingClients.docs.forEach((entry) => batch.delete(doc(db, "clients", entry.id)));

    snapshot.orders.forEach((order) => {
      batch.set(doc(db, "orders", order.id), order);
    });

    snapshot.clients.forEach((client) => {
      batch.set(doc(db, "clients", client.id), client);
    });

    await batch.commit();
  }

  return {
    orders,
    clients,
    ready,
    cloudEnabled,
    addOrders,
    saveOrder,
    removeOrder,
    saveClient,
    removeClient,
    importSnapshot
  };
}
