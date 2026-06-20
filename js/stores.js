// Persistent Store utility mirroring the GetInstantStore / GetExpireStore functionality from reference

const instantStoreRegistry = new Set();
const expireStoreRegistry = new Set();

const deepClone = (value) => JSON.parse(JSON.stringify(value));

const isPlainObject = (v) =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const topUp = (target, template, path) => {
  for (const key of Object.keys(template)) {
    const tplValue = template[key];
    const subPath = `${path}.${key}`;

    if (!(key in target)) {
      target[key] = deepClone(tplValue);
      continue;
    }

    const tgtValue = target[key];
    const tplIsObj = isPlainObject(tplValue);
    const tgtIsObj = isPlainObject(tgtValue);

    if (tplIsObj && tgtIsObj) {
      topUp(tgtValue, tplValue, subPath);
      continue;
    }
  }
};

const computeExpiresAt = (settings) => {
  const date = new Date();
  const { Duration, Unit } = settings;

  switch (Unit) {
    case "Seconds":
      return date.getTime() + Duration * 1000;
    case "Minutes":
      return date.getTime() + Duration * 60000;
    case "Hours":
      return date.getTime() + Duration * 3600000;
    case "Days":
      return date.getTime() + Duration * 86400000;
    case "Weeks":
      return date.getTime() + Duration * 7 * 86400000;
    case "Months":
      date.setMonth(date.getMonth() + Duration);
      return date.getTime();
    default:
      return date.getTime() + 86400000; // 1 day default
  }
};

export function GetInstantStore(storeName, version, template, forceNewData = false) {
  if (instantStoreRegistry.has(storeName)) {
    console.warn(`InstantStore "${storeName}" has already been retrieved`);
  }
  instantStoreRegistry.add(storeName);

  let items;

  if (forceNewData) {
    items = deepClone(template);
  } else {
    const raw = localStorage.getItem(storeName);
    let parsed = null;

    if (raw !== null) {
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = null;
      }
    }

    if (parsed !== null && parsed.Version === version) {
      items = parsed.Items;
      topUp(items, template, `${storeName}.Items`);
    } else {
      items = deepClone(template);
    }
  }

  const envelope = { Version: version, Items: items };

  const SaveChanges = () => {
    localStorage.setItem(storeName, JSON.stringify(envelope));
  };

  return Object.freeze({ Items: items, SaveChanges });
}

export function GetDynamicStoreItem(storeName, itemName) {
  const raw = localStorage.getItem(`${storeName}:${itemName}`);
  if (raw === null) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

export function SetDynamicStoreItem(storeName, itemName, content) {
  const str = typeof content === 'string' ? content : JSON.stringify(content);
  localStorage.setItem(`${storeName}:${itemName}`, str);
}

export function GetExpireStore(storeName, version, itemExpirationSettings, forceNewData = false) {
  if (expireStoreRegistry.has(storeName)) {
    console.warn(`ExpireStore "${storeName}" has already been retrieved`);
  }
  expireStoreRegistry.add(storeName);

  const requestUrl = (itemName) => `/${itemName}`;

  const GetItem = async (itemName) => {
    if (forceNewData) return undefined;

    try {
      const cache = await caches.open(storeName);
      const response = await cache.match(requestUrl(itemName));
      if (!response) return undefined;

      const wrapped = await response.json();
      if (wrapped.CacheVersion !== version) return undefined;
      if (wrapped.ExpiresAt < Date.now()) {
        cache.delete(requestUrl(itemName));
        return undefined;
      }

      return wrapped.Content;
    } catch (e) {
      console.warn(`GetExpireStore read error for "${itemName}":`, e);
      return undefined;
    }
  };

  const SetItem = async (itemName, content) => {
    const wrapped = {
      ExpiresAt: computeExpiresAt(itemExpirationSettings),
      CacheVersion: version,
      Content: content,
    };

    try {
      const cache = await caches.open(storeName);
      await cache.put(
        requestUrl(itemName),
        new Response(JSON.stringify(wrapped), {
          headers: { "Content-Type": "application/json" },
        })
      );
    } catch (err) {
      console.warn(`ExpireStore "${storeName}": failed to write item "${itemName}"`, err);
    }

    return content;
  };

  const RemoveItem = async (itemName) => {
    try {
      const cache = await caches.open(storeName);
      await cache.delete(requestUrl(itemName));
    } catch (err) {
      console.warn(`ExpireStore "${storeName}": error removing item "${itemName}"`, err);
    }
  };

  const Destroy = async () => {
    try {
      await caches.delete(storeName);
      expireStoreRegistry.delete(storeName);
    } catch (err) {
      console.warn(`ExpireStore "${storeName}": error destroying`, err);
    }
  };

  return Object.freeze({ GetItem, SetItem, RemoveItem, Destroy });
}
