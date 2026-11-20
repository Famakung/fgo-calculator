_in_memory_mapping = {}


def load_mapping():
    return dict(_in_memory_mapping)


def save_mapping(mapping):
    _in_memory_mapping.update(mapping)
