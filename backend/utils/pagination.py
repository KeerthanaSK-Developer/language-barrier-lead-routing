"""Shared pagination helpers for list endpoints."""
from math import ceil
from typing import Any, Dict, List, Tuple
from fastapi import Query, HTTPException

ALLOWED_PAGE_SIZES = (5, 10, 25, 100)  # 100 reserved for dropdown / select fetches


def get_pagination(
    page: int = Query(1, ge=1, description="Page number (1-based)"),
    page_size: int = Query(10, description="Items per page: 5, 10, or 25"),
) -> Tuple[int, int]:
    if page_size not in ALLOWED_PAGE_SIZES:
        raise HTTPException(
            status_code=400,
            detail=f"page_size must be one of {list(ALLOWED_PAGE_SIZES[:-1])} (or 100 for selects)",
        )
    return page, page_size


def skip_limit(page: int, page_size: int) -> Tuple[int, int]:
    return (page - 1) * page_size, page_size


def paginated(
    items: List[Any],
    total: int,
    page: int,
    page_size: int,
) -> Dict[str, Any]:
    total_pages = ceil(total / page_size) if total > 0 else 0
    return {
        "items": items,
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": total_pages,
    }
