import zipfile
import xml.etree.ElementTree as ET

def get_docx_text(path):
    """Simple docx text extractor using xml parsing."""
    try:
        with zipfile.ZipFile(path) as docx:
            xml_content = docx.read('word/document.xml')
        
        tree = ET.fromstring(xml_content)
        namespace = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
        
        text = []
        for p in tree.findall('.//w:p', namespace):
            p_text = []
            for t in p.findall('.//w:t', namespace):
                p_text.append(t.text)
            if p_text:
                text.append(''.join(p_text))
        
        return '\n'.join(text)
    except Exception as e:
        return f"Error: {str(e)}"

if __name__ == "__main__":
    content = get_docx_text('PhD_Proposal_FINAL_SUBMISSION_Apr2026_.docx')
    # Print first 2000 chars to see what's in there
    print(content[:5000])
