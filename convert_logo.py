import subprocess
import sys
import os

def install_packages():
    """Instala as dependências necessárias"""
    packages = ['Pillow', 'cairosvg']
    for package in packages:
        try:
            subprocess.check_call([sys.executable, '-m', 'pip', 'install', package])
            print(f"✅ {package} instalado com sucesso!")
        except subprocess.CalledProcessError:
            print(f"❌ Erro ao instalar {package}")
            return False
    return True

def convert_svg_to_png():
    """Converte o SVG para PNG nos tamanhos necessários"""
    try:
        import cairosvg
        from PIL import Image
        import io
        
        # Caminho do arquivo SVG
        svg_path = 'logo.svg'
        
        if not os.path.exists(svg_path):
            print(f"❌ Arquivo {svg_path} não encontrado!")
            return False
        
        # Converter para PNG 512x512
        png_512_data = cairosvg.svg2png(url=svg_path, output_width=512, output_height=512)
        with open('icon-512.png', 'wb') as f:
            f.write(png_512_data)
        print("✅ Ícone 512x512 criado: icon-512.png")
        
        # Converter para PNG 192x192
        png_192_data = cairosvg.svg2png(url=svg_path, output_width=192, output_height=192)
        with open('icon-192.png', 'wb') as f:
            f.write(png_192_data)
        print("✅ Ícone 192x192 criado: icon-192.png")
        
        # Criar também um favicon
        png_32_data = cairosvg.svg2png(url=svg_path, output_width=32, output_height=32)
        with open('favicon.png', 'wb') as f:
            f.write(png_32_data)
        print("✅ Favicon criado: favicon.png")
        
        return True
        
    except ImportError as e:
        print(f"❌ Erro de importação: {e}")
        print("Tentando instalar dependências...")
        if install_packages():
            return convert_svg_to_png()
        return False
    except Exception as e:
        print(f"❌ Erro ao converter: {e}")
        return False

if __name__ == "__main__":
    print("🦁 Convertendo logo SVG para PNG...")
    print("=" * 50)
    
    if convert_svg_to_png():
        print("\n🎉 Conversão concluída com sucesso!")
        print("Arquivos criados:")
        print("- icon-512.png (512x512px)")
        print("- icon-192.png (192x192px)")
        print("- favicon.png (32x32px)")
    else:
        print("\n❌ Falha na conversão!")