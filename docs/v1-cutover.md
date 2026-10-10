# v1.splashz.xyz cutover — manual steps

Run each line in your local terminal, in order. Lines starting with `sudo …` are run **on the server** after you SSH in. Sudo will prompt for the password once.

## 1. SSH in

```
ssh -i ~/.ssh/splash sebastian@165.22.106.67
```

## 2. Install staged nginx configs

```
sudo mv /tmp/v1.splashz.xyz.conf /etc/nginx/sites-available/v1.splashz.xyz.conf
```

```
sudo mv /tmp/splashz.xyz.gone.conf /etc/nginx/sites-available/splashz.xyz.gone.conf
```

```
sudo ln -sf /etc/nginx/sites-available/v1.splashz.xyz.conf /etc/nginx/sites-enabled/v1.splashz.xyz.conf
```

```
sudo ln -sf /etc/nginx/sites-available/splashz.xyz.gone.conf /etc/nginx/sites-enabled/splashz.xyz.gone.conf
```

## 3. Remove the old bare-splashz.xyz config

```
sudo rm /etc/nginx/sites-enabled/v4.splashz.xyz.conf
```

## 4. Extend SSL cert to cover v1.splashz.xyz

```
sudo certbot --nginx --expand --non-interactive --agree-tos -d splashz.xyz -d www.splashz.xyz -d v1.splashz.xyz -d v2.splashz.xyz -d v3.splashz.xyz -d v4.splashz.xyz
```

## 5. Validate and reload nginx

```
sudo nginx -t
```

```
sudo systemctl reload nginx
```

## 6. Restart Next.js to pick up new admin/contracts code

```
sudo systemctl restart splash-v4.service
```

## 7. Verify

```
curl -sI https://v1.splashz.xyz/ | head -3
```

```
curl -sI https://splashz.xyz/ | head -3
```

Expected: v1 returns `200` (or a 307 redirect), bare splashz.xyz returns `410 Gone`.

## 8. Exit the server

```
exit
```
