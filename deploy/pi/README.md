# Raspberry Pi Web Host

This directory contains reusable Raspberry Pi hosting support for the SHV Bias Filter web app and solver backend. Keep site-specific hostnames, IP addresses, local checkout paths, passwords, and private keys in ignored local notes such as `.secrets/current-deployment.md`.

The recommended deployment is a dedicated AI development Pi with blanket passwordless sudo for the `agent` account. The agent may administer the machine as needed, while Git or other off-device storage holds the durable copy of the work. Reimage the microSD card if experimentation leaves the OS in an inconvenient state. Use narrower privileges when adapting these files to a shared or production host.

The root README sends humans to a short guide for their chosen coding agent. That agent should then follow [agent-setup.md](agent-setup.md) from the user's current starting point, including OS guidance and creation of dedicated SSH access. Package details are split into [package-requirements.md](package-requirements.md).

## Layout

The agent setup guide uses these variables:

- `PROJECT_DIR` - repository checkout or synced working tree on the Pi.
- `STATIC_ROOT` - web server document root on the Pi.
- `APP_PATH` - URL path for the app, usually `/shv-bias-filter/`.
- `STATIC_DIR` - static files for the app, usually `STATIC_ROOT` plus `APP_PATH`.
- `SERVICE_NAME` - systemd service name.

The included service file contains placeholders. The setup agent must render it with the user's chosen `AGENT_USER`, `PROJECT_DIR`, and `STATIC_ROOT` before installing it.

## Service

`agent-sites.service` runs the repository's dependency-free Python field backend on port 80 as the agent user. It serves the landing page, the SHV Bias Filter web app, and `/api/field-solve` job endpoints. The service uses `AmbientCapabilities=CAP_NET_BIND_SERVICE` so it can bind port 80 without running as root.

The backend accepts `--solver fd`, `--solver auto`, and `--solver fenicsx`. The Pi package stack for FEniCSx/DOLFINx/Gmsh is installed and the conforming worker is implemented. The service is still intentionally started with requested/effective default solver `fd` so normal page loads use the faster screening path; use the web dropdown's `FEniCSx required` option when deliberately running the conforming FEA worker.

The systemd unit sets `MemorySwapMax=0`. The backend and all FEniCSx subprocesses therefore stay in the same no-swap cgroup, avoiding solver-driven swap writes on SD-card deployments. If a solve exhausts available RAM, it should fail rather than spill into swap; keep the worker count at one and reduce mesh density for oversized jobs.

## Reporting Access

After setup, the agent must report the actual hostname or IP address it verified, using clickable links for the app and backend health endpoint. Do not commit those current-access details to this repository.
