import { request } from "node:https";
import { isIPv4 } from "node:net";
export async function telegramRequest(
  token,
  method,
  body,
  signal,
  connectIPv4,
) {
  const url = `https://api.telegram.org/bot${token}/${method}`;
  const payload = JSON.stringify(body);
  if (!connectIPv4)
    return fetch(url, {
      method: "POST",
      redirect: "error",
      headers: {
        "Content-Type": "application/json",
      },
      body: payload,
      signal,
    });
  if (!isIPv4(connectIPv4)) throw new Error("Invalid Telegram IPv4 override");
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
        family: 4,
        servername: "api.telegram.org",
        rejectUnauthorized: true,
        lookup: (_hostname, _options, callback) =>
          callback(null, connectIPv4, 4),
        signal,
      },
      (res) => {
        const chunks = [];
        let bytes = 0;
        res.on("data", (chunk) => {
          bytes += chunk.length;
          if (bytes > 1024 * 1024) {
            res.destroy(new Error("Telegram response too large"));
            return;
          }
          chunks.push(chunk);
        });
        res.on("error", reject);
        res.on("end", () =>
          resolve(
            new Response(Buffer.concat(chunks), {
              status: res.statusCode ?? 502,
              headers: {
                "Content-Type": "application/json",
              },
            }),
          ),
        );
      },
    );
    req.on("error", reject);
    req.end(payload);
  });
}
