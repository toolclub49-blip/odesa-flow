"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, deleteDoc, doc, getDocs, onSnapshot, orderBy, query, setDoc, writeBatch } from "firebase/firestore";
import { getDb, isFirebaseConfigured } from "@/lib/firebase";
import type { AppSnapshot, ClientRecord, OrderRecord } from "@/types";
import { createId } from "@/lib/utils";

const LOCAL_ORDERS_KEY = "odessa_orders_v1";
const LOCAL_CLIENTS_KEY = "odessa_clients_v1";

function getUserCollectionPath(uid: string, entity: "orders" | "clients") {
  return ["users", uid, entity] as const;
}

function getMigrationFlagKey(uid: string) {
  return `odessa_legacy_migrated_${uid}`;
}

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

async function migrateLegacySnapshot(uid: string) {
  const db = getDb();
  if (!db || typeof window === "undefined") return;

  try {
    const migrationFlag = getMigrationFlagKey(uid);
    if (localStorage.getItem(migrationFlag) === "done") return;

    const userOrdersRef = collection(db, ...getUserCollectionPath(uid, "orders"));
    const userClientsRef = collection(db, ...getUserCollectionPath(uid, "clients"));
    const [userOrders, userClients] = await Promise.all([getDocs(userOrdersRef), getDocs(userClientsRef)]);

    if (!userOrders.empty || !userClients.empty) {
      localStorage.setItem(migrationFlag, "done");
      return;
    }

    const [legacyOrders, legacyClients] = await Promise.all([getDocs(collection(db, "orders")), getDocs(collection(db, "clients"))]);
    if (legacyOrders.empty && legacyClients.empty) {
      localStorage.setItem(migrationFlag, "done");
      return;
    }

    const batch = writeBatch(db);
    legacyOrders.docs.forEach((entry) => {
      batch.set(doc(db, ...getUserCollectionPath(uid, "orders"), entry.id), {
        ...(entry.data() as Omit<OrderRecord, "id">),
        id: entry.id
      });
    });
    legacyClients.docs.forEach((entry) => {
      batch.set(doc(db, ...getUserCollectionPath(uid, "clients"), entry.id), {
        ...(entry.data() as Omit<ClientRecord, "id">),
        id: entry.id
      });
    });
    await batch.commit();
    localStorage.setItem(migrationFlag, "done");
  } catch {
    return;
  }
}

export function useCRMData(uid: string | null) {
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [clients, setClients] = useState<ClientRecord[]>([]);
  const [ready, setReady] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const cloudEnabled = useMemo(() => isFirebaseConfigured(), []);
  const useLocalMode = !cloudEnabled || syncError !== null;

  useEffect(() => {
    if (cloudEnabled && !uid) {
      setOrders([]);
      setClients([]);
      setReady(true);
      return;
    }

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

    setReady(false);
    void migrateLegacySnapshot(uid!);

    const ordersQuery = query(collection(db, ...getUserCollectionPath(uid!, "orders")), orderBy("createdAt", "desc"));
    const clientsQuery = query(collection(db, ...getUserCollectionPath(uid!, "clients")), orderBy("name", "asc"));
    let orderReady = false;
    let clientReady = false;

    const markReady = () => {
      if (orderReady && clientReady) {
        setReady(true);
      }
    };

    const handleSyncError = (error: unknown) => {
      const snapshot = readLocal();
      setOrders(snapshot.orders);
      setClients(snapshot.clients);
      setSyncError(error instanceof Error ? error.message : "Firestore sync failed");
      setReady(true);
    };

    const unsubOrders = onSnapshot(
      ordersQuery,
      (snapshot) => {
        setOrders(snapshot.docs.map((item) => ({ ...(item.data() as Omit<OrderRecord, "id">), id: item.id })));
        orderReady = true;
        setSyncError(null);
        markReady();
      },
      handleSyncError
    );

    const unsubClients = onSnapshot(
      clientsQuery,
      (snapshot) => {
        setClients(snapshot.docs.map((item) => ({ ...(item.data() as Omit<ClientRecord, "id">), id: item.id })));
        clientReady = true;
        setSyncError(null);
        markReady();
      },
      handleSyncError
    );

    return () => {
      unsubOrders();
      unsubClients();
    };
  }, [cloudEnabled, uid]);

  useEffect(() => {
    if (useLocalMode && ready) {
      writeLocal({ orders, clients });
    }
  }, [orders, clients, ready, useLocalMode]);

  async function addOrders(newOrders: OrderRecord[]) {
    if (useLocalMode) {
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
    if (!db || !uid) return;
    const batch = writeBatch(db);
    const existingClients = new Map(clients.map((client) => [client.phone, client]));

    newOrders.forEach((order) => {
      batch.set(doc(db, ...getUserCollectionPath(uid, "orders"), order.id), order);

      const existingClient = existingClients.get(order.phone);
      if (existingClient) {
        batch.set(
          doc(db, ...getUserCollectionPath(uid, "clients"), existingClient.id),
          {
            ...existingClient,
            name: order.name || existingClient.name,
            addr: order.addr || existingClient.addr,
            updatedAt: Date.now()
          },
          { merge: true }
        );
      } else {
        const clientId = createId();
        batch.set(doc(db, ...getUserCollectionPath(uid, "clients"), clientId), {
          id: clientId,
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
    if (useLocalMode) {
      setOrders((prev) => prev.map((item) => (item.id === order.id ? order : item)));
      return;
    }
    const db = getDb();
    if (!db || !uid) return;
    await setDoc(doc(db, ...getUserCollectionPath(uid, "orders"), order.id), order, { merge: true });
  }

  async function removeOrder(orderId: string) {
    if (useLocalMode) {
      setOrders((prev) => prev.filter((item) => item.id !== orderId));
      return;
    }
    const db = getDb();
    if (!db || !uid) return;
    await deleteDoc(doc(db, ...getUserCollectionPath(uid, "orders"), orderId));
  }

  async function saveClient(client: ClientRecord) {
    if (useLocalMode) {
      setClients((prev) => prev.map((item) => (item.id === client.id ? client : item)));
      return;
    }
    const db = getDb();
    if (!db || !uid) return;
    await setDoc(doc(db, ...getUserCollectionPath(uid, "clients"), client.id), client, { merge: true });
  }

  async function removeClient(clientId: string) {
    if (useLocalMode) {
      setClients((prev) => prev.filter((item) => item.id !== clientId));
      return;
    }
    const db = getDb();
    if (!db || !uid) return;
    await deleteDoc(doc(db, ...getUserCollectionPath(uid, "clients"), clientId));
  }

  async function importSnapshot(snapshot: AppSnapshot) {
    if (useLocalMode) {
      setOrders(snapshot.orders);
      setClients(snapshot.clients);
      return;
    }

    const db = getDb();
    if (!db || !uid) return;
    const batch = writeBatch(db);

    const userOrdersRef = collection(db, ...getUserCollectionPath(uid, "orders"));
    const userClientsRef = collection(db, ...getUserCollectionPath(uid, "clients"));

    const existingOrders = await getDocs(userOrdersRef);
    existingOrders.docs.forEach((entry) => batch.delete(doc(db, ...getUserCollectionPath(uid, "orders"), entry.id)));
    const existingClients = await getDocs(userClientsRef);
    existingClients.docs.forEach((entry) => batch.delete(doc(db, ...getUserCollectionPath(uid, "clients"), entry.id)));

    snapshot.orders.forEach((order) => {
      batch.set(doc(db, ...getUserCollectionPath(uid, "orders"), order.id), order);
    });

    snapshot.clients.forEach((client) => {
      batch.set(doc(db, ...getUserCollectionPath(uid, "clients"), client.id), client);
    });

    await batch.commit();
  }

  return {
    orders,
    clients,
    ready,
    syncError,
    cloudEnabled,
    useLocalMode,
    addOrders,
    saveOrder,
    removeOrder,
    saveClient,
    removeClient,
    importSnapshot
  };
}
