class FetchContext:
    """Holds injectable fetch functions and shared state for I/O decoupling."""

    def __init__(
        self,
        fetch=None,
        fetch_inner_skill=None,
        counter_name=None,
        functions=None,
        svt_data=None,
        invert_perspective=False,
    ):
        self.fetch = fetch
        self.fetch_inner_skill = fetch_inner_skill
        self.counter_name = counter_name
        self.functions = functions
        self.svt_data = svt_data
        self.invert_perspective = invert_perspective

    def with_perspective(self, invert_perspective):
        return FetchContext(
            fetch=self.fetch,
            fetch_inner_skill=self.fetch_inner_skill,
            counter_name=self.counter_name,
            functions=self.functions,
            svt_data=self.svt_data,
            invert_perspective=invert_perspective,
        )
