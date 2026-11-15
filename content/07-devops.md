---
id: devops
title: DevOps & Cloud
short: DevOps
color: #f97316
blurb: Docker, CI/CD, Nginx, Linux, AWS, Kubernetes basics, zero-downtime deployments, monitoring and the "how do you deploy this" questions full-stack devs now get.
---

## Cheatsheet
- **Image** = read-only template; **container** = running instance of an image.
- Small images: **multi-stage builds**, slim/alpine base, `.dockerignore`, copy `package.json` first for **layer caching**.
- CI = build + test on every push; CD = deploy automatically (or with one approval) after CI passes.
- Zero downtime: **rolling**, **blue-green** or **canary** deploys + health checks + backward-compatible DB migrations.
- Nginx: reverse proxy, TLS termination, load balancing, gzip, static files, rate limiting.
- Logs, metrics, traces = the **three pillars of observability**.
- Secrets never in git or images: use env vars from a **secret manager** (AWS Secrets Manager, Vault, GitHub secrets).
- Kubernetes: **Pod** (containers), **Deployment** (replicas + rolling updates), **Service** (stable network), **Ingress** (HTTP routing), **HPA** (autoscaling).
- Useful Linux: `top/htop`, `df -h`, `free -m`, `ss -tulpn`, `journalctl -u`, `tail -f`, `grep`, `chmod/chown`.

## Docker

### What is Docker and why use it? Image vs container? {basic, hot}
Docker packages an app with **everything it needs** (runtime, libraries, config) into an image, so it runs the same on every machine: "works on my machine" goes away.

- **Image**: read-only, layered template built from a Dockerfile.
- **Container**: a running, isolated instance of an image (its own filesystem, network, processes).
- Containers share the host **kernel**, so they are much lighter than VMs.

### Write a production Dockerfile for a Node.js app. {mid, hot}
```dockerfile
# ---- build stage ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---- runtime stage ----
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
USER node
EXPOSE 3000
HEALTHCHECK CMD wget -qO- http://localhost:3000/health || exit 1
CMD ["node", "dist/server.js"]
```

Key points to say:
- **Multi-stage** build → small final image without dev dependencies and source.
- Copy `package*.json` and install **before** copying code → dependency layer is cached.
- Run as **non-root** user, add a `.dockerignore` (node_modules, .git, .env).
- `npm ci` for reproducible installs.

### Dockerfile for a Laravel app (PHP-FPM + Nginx) {mid}
Typical setup: one container for **PHP-FPM** (app code), one for **Nginx** (proxy to FPM), plus MySQL/Redis/queue worker containers via Docker Compose.

```dockerfile
FROM php:8.3-fpm-alpine
RUN docker-php-ext-install pdo_mysql opcache bcmath
COPY --from=composer:2 /usr/bin/composer /usr/bin/composer
WORKDIR /var/www
COPY composer.* ./
RUN composer install --no-dev --no-scripts --prefer-dist
COPY . .
RUN composer dump-autoload -o && php artisan config:cache && php artisan route:cache \
    && chown -R www-data:www-data storage bootstrap/cache
USER www-data
```

Run the queue worker as a separate container using the same image: `php artisan queue:work`.

### `CMD` vs `ENTRYPOINT`, `COPY` vs `ADD` {basic}
- `ENTRYPOINT`: the fixed executable. `CMD`: default arguments (easily overridden by `docker run image other-cmd`).
- `COPY`: copies local files (prefer it). `ADD`: also extracts tar files and can download URLs.

### What is Docker Compose? {basic}
A YAML file to define and run **multi-container** apps locally: app, database, Redis, worker, with networks and volumes. `docker compose up -d`.

**Volumes** persist data (DB files) beyond the container's life; **networks** let containers talk by service name (`mysql:3306`).

## CI/CD

### Explain a CI/CD pipeline you have built. {mid, hot}
A typical pipeline (GitHub Actions / GitLab CI / Jenkins):

1. **Trigger** on push / pull request.
2. **Install** dependencies (with cache).
3. **Lint + type check + unit tests**.
4. **Build** Docker image, tag with the commit SHA, push to a registry (ECR / Docker Hub).
5. **Security scan** (npm audit, Trivy).
6. **Deploy to staging** automatically, run smoke tests.
7. **Deploy to production** on merge to main or with manual approval.
8. **Run migrations**, health check, and **roll back** automatically if it fails.

```yaml
name: ci
on: [push]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - run: npm run lint && npm test
```

### How do you deploy with zero downtime? {senior, hot}
- **Rolling update**: replace instances a few at a time; the load balancer only sends traffic to instances that pass the **health check**.
- **Blue-green**: run the new version (green) next to the old (blue), switch traffic at once; instant rollback by switching back.
- **Canary**: send 5% of traffic to the new version, watch error rates, then increase.

Also needed:
- **Graceful shutdown** (finish in-flight requests on SIGTERM).
- **Backward-compatible DB migrations** (expand → migrate → contract): add a new column first, deploy code that writes both, remove the old column in a later release.
- For PHP on a VM: build into a new release folder and **switch a symlink** (Envoyer/Deployer), then `php artisan queue:restart` and reload PHP-FPM.

### How do you manage secrets and environment config? {mid}
- Never commit `.env`; commit a `.env.example`.
- CI secrets in GitHub/GitLab secrets; runtime secrets in **AWS Secrets Manager / Parameter Store / Vault / Kubernetes Secrets**.
- Different values per environment (dev, staging, prod); rotate keys; least-privilege IAM roles instead of long-lived access keys.

## Servers & Networking

### What does Nginx do in your stack? {mid, hot}
- **Reverse proxy** to Node (port 3000) or PHP-FPM.
- **TLS/HTTPS termination** (Let's Encrypt certificates).
- **Load balancing** across several app instances.
- Serve **static files** and cache them; gzip/brotli compression.
- Rate limiting, request size limits, security headers.

```nginx
upstream api { server 127.0.0.1:3000; server 127.0.0.1:3001; }
server {
  listen 443 ssl http2;
  server_name api.example.com;
  location / {
    proxy_pass http://api;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header Upgrade $http_upgrade;     # WebSockets
    proxy_set_header Connection "upgrade";
  }
}
```

### What happens when you type a URL in the browser? {mid, hot}
1. **DNS** lookup: domain → IP (browser cache → OS → resolver → root/TLD/authoritative).
2. **TCP** handshake (and **TLS** handshake for HTTPS).
3. Browser sends the **HTTP request**; it may hit a **CDN**, load balancer, Nginx, then the app server.
4. App runs logic, queries DB/cache, returns a response.
5. Browser parses HTML, builds the DOM and CSSOM, runs JS, **lays out and paints** the page, loading more resources in parallel.

### 502 vs 503 vs 504 errors {mid}
- **502 Bad Gateway**: proxy got an invalid response; app crashed, wrong port, PHP-FPM down.
- **503 Service Unavailable**: server overloaded or in maintenance; no healthy instances.
- **504 Gateway Timeout**: app took too long (slow query, external API hanging); proxy timeout hit.

### Useful Linux commands for debugging a server {basic}
- CPU/memory: `top`, `htop`, `free -m`, `vmstat 1`
- Disk: `df -h`, `du -sh *` (a full disk is a classic outage cause)
- Ports/processes: `ss -tulpn`, `lsof -i :3000`, `ps aux | grep node`
- Logs: `tail -f /var/log/nginx/error.log`, `journalctl -u app -f`
- Network: `curl -I`, `dig`, `ping`, `traceroute`
- Permissions: `chmod`, `chown`

## Cloud & Kubernetes

### Which AWS services have you used and for what? {mid, hot}
| Service | Use |
|---|---|
| **EC2** | Virtual servers |
| **S3** | File storage (uploads, backups, static sites) + **CloudFront** CDN |
| **RDS / Aurora** | Managed MySQL/Postgres with backups and read replicas |
| **ElastiCache** | Managed Redis |
| **SQS / SNS** | Queues and pub/sub |
| **Lambda** | Serverless functions (image resize, webhooks) |
| **ECS / EKS** | Run containers |
| **ALB** | Load balancer with health checks |
| **IAM** | Users, roles, permissions |
| **CloudWatch** | Logs, metrics, alarms |
| **Route 53** | DNS |

### Kubernetes basics: Pod, Deployment, Service, Ingress {mid}
- **Pod**: smallest unit; one or more containers sharing network and storage.
- **Deployment**: keeps N replicas of a pod running and does **rolling updates** and rollbacks.
- **Service**: stable IP/DNS name that load-balances across pods.
- **Ingress**: HTTP routing from outside (domains, paths, TLS).
- **ConfigMap / Secret**: configuration and secrets.
- **HPA**: scale pods automatically on CPU/memory/custom metrics.
- **Liveness probe** (restart if dead) vs **readiness probe** (don't send traffic until ready).

### Horizontal vs vertical scaling {basic, hot}
- **Vertical (scale up)**: bigger machine (more CPU/RAM). Simple, but has a ceiling and usually downtime.
- **Horizontal (scale out)**: more machines behind a load balancer. Near-unlimited and fault tolerant, but the app must be **stateless** (sessions in Redis, files in S3).

## Monitoring

### How do you monitor a production application? {mid, hot}
- **Logs**: structured JSON logs with request ID, shipped to ELK / Loki / CloudWatch.
- **Metrics**: request rate, error rate, latency (p95/p99), CPU, memory, queue length; Prometheus + Grafana or Datadog.
- **Traces**: follow one request across services (OpenTelemetry, Jaeger).
- **Error tracking**: Sentry.
- **Alerts** on symptoms users feel (error rate, latency, failed payments), with on-call runbooks.
- **Uptime checks** and health endpoints.

> [!say] "We track the RED metrics (rate, errors, duration) per endpoint, alert on p99 latency and 5xx rate, and every log line carries a correlation ID so we can trace one request end to end."
