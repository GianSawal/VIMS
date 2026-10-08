from rest_framework.pagination import PageNumberPagination


class Pagination(PageNumberPagination):
    page_size = 25
    page_size_query_param = 'page_size'  # lets dropdowns fetch a full reference list
    max_page_size = 500
