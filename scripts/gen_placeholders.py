"""生成占位资源：头像 avatar.jpg、简历 CV（中英两份 PDF）。

真实素材就位后，直接用你的文件覆盖 public/ 下的同名文件即可，无需再跑本脚本。
"""
import os
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
PUBLIC = os.path.join(HERE, "..", "public")
CV_DIR = os.path.join(PUBLIC, "cv")
os.makedirs(CV_DIR, exist_ok=True)


def load_font(size: int):
    """优先用系统字体，找不到就退回 PIL 默认字体。"""
    candidates = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
        "/usr/share/fonts/truetype/freefont/FreeSans.ttf",
    ]
    for path in candidates:
        if os.path.exists(path):
            return ImageFont.truetype(path, size)
    try:
        return ImageFont.load_default(size=size)
    except TypeError:  # 旧版 PIL 不支持 size 参数
        return ImageFont.load_default()


def make_avatar(path: str, size: int = 512):
    """人形剪影占位头像：不依赖字体，任何环境都能生成。"""
    img = Image.new("RGB", (size, size), "#f1f3f5")
    d = ImageDraw.Draw(img)

    body = "#adb5bd"
    cx = size // 2

    # 肩部（下半椭圆）
    d.ellipse([cx - size * 0.28, size * 0.56, cx + size * 0.28, size * 1.12], fill=body)
    # 头部
    d.ellipse([cx - size * 0.16, size * 0.19, cx + size * 0.16, size * 0.51], fill=body)

    img.save(path, "JPEG", quality=90)
    print("生成头像:", path)


def make_cv_pdf(path: str, title: str, hint: str):
    w, h = 595, 842  # A4 @72dpi
    img = Image.new("RGB", (w, h), "white")
    d = ImageDraw.Draw(img)

    f_title = load_font(28)
    f_body = load_font(15)

    d.text((60, 90), title, fill="#1f2328", font=f_title)
    d.text((60, 160), hint, fill="#656d76", font=f_body)
    d.text((60, 190), "Replace this file with your own CV.", fill="#656d76", font=f_body)
    d.text((60, 216), "Same filename, same path.", fill="#656d76", font=f_body)

    # 虚线边框，提示这是占位
    d.rectangle([40, 40, w - 40, h - 40], outline="#c9ced4", width=2)

    img.save(path, "PDF")
    print("生成简历占位:", path)


if __name__ == "__main__":
    make_avatar(os.path.join(PUBLIC, "avatar.jpg"))
    make_cv_pdf(
        os.path.join(CV_DIR, "cv-zh.pdf"),
        "简历占位文件",
        "请用你的中文简历替换 public/cv/cv-zh.pdf",
    )
    make_cv_pdf(
        os.path.join(CV_DIR, "cv-en.pdf"),
        "CV Placeholder",
        "Replace public/cv/cv-en.pdf with your English CV",
    )
