class FetchContext:
    """Holds injectable fetch functions and shared state for I/O decoupling."""

    def __init__(self, fetch=None, fetch_inner_skill=None, counter_name=None, functions=None, svt_data=None):
        self.fetch = fetch
        self.fetch_inner_skill = fetch_inner_skill
        self.counter_name = counter_name
        self.functions = functions
        self.svt_data = svt_data
