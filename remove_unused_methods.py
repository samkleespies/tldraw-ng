#!/usr/bin/env python3

import re

# List of unused methods to remove
unused_methods = [
    "tessellate_thin_line",
    "tessellate_small_cap", 
    "tessellate_stroke_polygon",
    "tessellate_smooth_line",
    "tessellate_line_cap",
    "tessellate_draw_polygon", 
    "get_point_direction",
    "tessellate_tiny_join",
    "tessellate_round_cap",
    "tessellate_simple_round_join"
]

def remove_unused_methods(file_path):
    with open(file_path, 'r') as f:
        content = f.read()
    
    for method_name in unused_methods:
        # Pattern to match the entire method including its body
        pattern = rf'    fn {method_name}\([^{{]*\) -> [^{{]*\{{[^}}]*\}}(?:\s*\n)*'
        # For methods without return type
        pattern2 = rf'    fn {method_name}\([^{{]*\) \{{(?:[^{{}}]*\{{[^}}]*\}})*[^}}]*\}}(?:\s*\n)*'
        
        # Try both patterns
        content = re.sub(pattern, '', content, flags=re.DOTALL)
        content = re.sub(pattern2, '', content, flags=re.DOTALL)
    
    # Clean up extra blank lines
    content = re.sub(r'\n\s*\n\s*\n', '\n\n', content)
    
    with open(file_path, 'w') as f:
        f.write(content)

if __name__ == "__main__":
    remove_unused_methods("crates/core/src/lib.rs")
    print("Removed unused methods")
