from bs4 import BeautifulSoup

with open('update/bookbuddy.htm', 'r', encoding='utf-8') as f:
    html_content = f.read()

soup = BeautifulSoup(html_content, 'html.parser')
titles = soup.find_all('td', class_='title')
container = titles[0].find_parent('table')
print(container.prettify()[:1000])
