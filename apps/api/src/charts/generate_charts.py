#!/usr/bin/env python3
# -*- coding: utf-8 -*-

# Attempts to use networkx-mcp-server to model graph relationships; falls back to networkx.
# Generates base64-encoded PNG charts for inclusion in markdown.

import io
import json
import math
import sys
import base64

# Matplotlib in headless environments
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

# Try to import networkx and networkx_mcp (optional)
try:
    import networkx as nx  # type: ignore
except Exception:
    nx = None

try:
    from networkx_mcp.server import create_graph, add_nodes, add_edges  # type: ignore
    HAS_NX_MCP = True
except Exception:
    HAS_NX_MCP = False


def read_input():
    raw = sys.stdin.read()
    try:
        data = json.loads(raw) if raw else {}
    except Exception:
        data = {}
    picks = data.get("picks") or []
    sites = data.get("sites") or []
    return picks, sites


def fig_to_data_url(fig) -> str:
    buf = io.BytesIO()
    fig.tight_layout()
    fig.savefig(buf, format="png", dpi=160)
    plt.close(fig)
    buf.seek(0)
    b64 = base64.b64encode(buf.read()).decode("ascii")
    return f"data:image/png;base64,{b64}"


def chart_benefit_vs_cost(picks):
    if not picks:
        return None
    fig, ax = plt.subplots(figsize=(6, 4))
    xs = [max(1, float(p.get("cost", 0))) for p in picks]
    ys = [float(p.get("benefit", 0.0)) for p in picks]
    labels = [str(p.get("id", "?")) for p in picks]

    ax.scatter(xs, ys, c="#7ac7ff", edgecolors="#1b3b5f", alpha=0.9)
    for x, y, lab in zip(xs, ys, labels):
        ax.annotate(lab, (x, y), textcoords="offset points", xytext=(4, 4), fontsize=8, color="#dfe9f3")

    ax.set_xscale("log") if max(xs) / max(1, min(xs)) > 50 else None
    ax.set_xlabel("Cost (USD)")
    ax.set_ylabel("Benefit (risk reduction)")
    ax.set_title("Benefit vs Cost of Selected Strategies")
    ax.grid(True, linestyle=":", alpha=0.3)

    return {
        "title": "Benefit vs Cost",
        "description": "Scatter plot of strategy cost vs expected risk reduction.",
        "dataUrl": fig_to_data_url(fig),
    }


def chart_risk_distribution(sites):
    if not sites:
        return None
    risks = [float(s.get("Risk", 0.0)) for s in sites if s is not None]
    if not risks:
        return None

    bins = [0.0, 0.2, 0.4, 0.6, 0.8, 1.0]
    labels = ["0.0-0.2", "0.2-0.4", "0.4-0.6", "0.6-0.8", "0.8-1.0"]

    fig, ax = plt.subplots(figsize=(6, 4))
    ax.hist(risks, bins=bins, color="#9be9a8", edgecolor="#2c4c2e", alpha=0.85)
    ax.set_xticks(bins)
    ax.set_xlabel("Risk score")
    ax.set_ylabel("Number of sites")
    ax.set_title("Portfolio Risk Distribution")
    ax.grid(True, linestyle=":", alpha=0.25)

    return {
        "title": "Risk Distribution",
        "description": "Histogram of site risk scores across the portfolio.",
        "dataUrl": fig_to_data_url(fig),
    }


def chart_optimization_graph(picks):
    """
    Try to build a simple relationship graph of strategies to aggregate impact nodes.
    Attempts to use networkx-mcp-server APIs; falls back to networkx if unavailable.
    """
    if not picks or nx is None:
        return None

    # Build a small graph: Strategy nodes connected to two hubs: "Budget" and "RiskReduction"
    try:
        if HAS_NX_MCP:
            # Use the MCP server's API to define the same structure (for demonstration purposes)
            create_graph("optimization_graph", "undirected")
            add_nodes("optimization_graph", ["Budget", "RiskReduction"])  # hubs
            add_nodes("optimization_graph", [str(p.get("id", "?")) for p in picks])
            # Edges (conceptual):
            for p in picks:
                pid = str(p.get("id", "?"))
                add_edges("optimization_graph", [(pid, "Budget"), (pid, "RiskReduction")])
    except Exception:
        # If MCP calls fail, proceed with pure networkx below
        pass

    # Render with networkx
    try:
        G = nx.Graph()
        G.add_node("Budget")
        G.add_node("RiskReduction")
        for p in picks:
            pid = str(p.get("id", "?"))
            G.add_node(pid)
            G.add_edge(pid, "Budget", weight=max(1.0, float(p.get("cost", 1)) / 1_000_000.0))
            G.add_edge(pid, "RiskReduction", weight=max(0.01, float(p.get("benefit", 0.0))))

        pos = nx.spring_layout(G, seed=42)
        fig, ax = plt.subplots(figsize=(6, 4))
        nx.draw_networkx_nodes(G, pos, nodelist=[n for n in G.nodes if n not in ("Budget", "RiskReduction")], node_size=400, node_color="#d1e8ff", edgecolors="#1b3b5f")
        nx.draw_networkx_nodes(G, pos, nodelist=["Budget", "RiskReduction"], node_size=700, node_color="#ffd6a5", edgecolors="#5f3b1b")
        nx.draw_networkx_labels(G, pos, font_size=8)
        nx.draw_networkx_edges(G, pos, width=1.2, edge_color="#88a" )
        ax.set_axis_off()
        ax.set_title("Strategy Relationship Graph")
        return {
            "title": "Strategy Graph",
            "description": "Network diagram linking strategies to budget and risk-reduction hubs.",
            "dataUrl": fig_to_data_url(fig),
        }
    except Exception:
        return None


def main():
    picks, sites = read_input()

    images = []

    try:
        c1 = chart_benefit_vs_cost(picks)
        if c1:
            images.append(c1)
    except Exception:
        pass

    try:
        c2 = chart_risk_distribution(sites)
        if c2:
            images.append(c2)
    except Exception:
        pass

    try:
        c3 = chart_optimization_graph(picks)
        if c3:
            images.append(c3)
    except Exception:
        pass

    out = {"images": images, "meta": {"nx_mcp_used": HAS_NX_MCP, "count": len(images)}}
    sys.stdout.write(json.dumps(out))


if __name__ == "__main__":
    main()